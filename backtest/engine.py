"""
Репликация скоринга «Разлом-26» на исторических данных.

Ключевые принципы честности:
- каждая серия сдвинута на реальный лаг публикации (T+1 рынки, T+35 пейроллы,
  T+43 CPI, T+35 SLOOS, T+12 длящиеся заявки, T+120 ВВП и т.д.);
- сигнал дня t исполняется по закрытию t+1;
- индикаторы, чьих данных в эпоху не существовало (SOFR до 2018, SRF до 2019,
  VIX3M до 2008, BTC до 2011...) считаются «нет данных» — как в панели,
  блок агрегирует по доступным семьям;
- абсолютные пороги, откалиброванные под 2026 (иена 152/158, нефть 80/95,
  заявки 2.05М), в базовом «как построено» режиме сохранены, но отдельный
  режим era_fair заменяет их относительными/дефлированными аналогами —
  сама методология панели помечает эти пороги как режимо-зависимые
  с ежегодной ревизией.
"""
import pandas as pd
import numpy as np
import json, os

DATA = os.path.join(os.path.dirname(__file__), "data")

# ---------- загрузка ----------
def fred(series):
    p = os.path.join(DATA, series + ".csv")
    df = pd.read_csv(p)
    df.columns = ["date", "v"]
    df["date"] = pd.to_datetime(df["date"])
    df["v"] = pd.to_numeric(df["v"], errors="coerce")
    return df.dropna().set_index("date")["v"].sort_index()

def stooq(name, col="Close"):
    p = os.path.join(DATA, name + "_stooq.csv")
    df = pd.read_csv(p)
    df["Date"] = pd.to_datetime(df["Date"])
    return df.set_index("Date")[col].sort_index()

def yahoo(name):
    with open(os.path.join(DATA, name + ".json")) as f:
        j = json.load(f)
    r = j["chart"]["result"][0]
    ts = pd.to_datetime(pd.Series(r["timestamp"]), unit="s").dt.normalize()
    close = pd.Series(r["indicators"]["quote"][0]["close"], index=ts)
    return close.dropna().sort_index()

# лаг публикации (календарных дней от даты наблюдения до доступности)
LAGS = {
    "SOFR": 1, "IORB": 1, "IOER": 1, "RRPONTSYD": 1, "RPONTSYD": 1,
    "WALCL": 2, "WTREGEN": 2, "WRESBAL": 2,          # H.4.1: среда -> четверг вечер
    "NFCI": 5,                                        # неделя -> следующая среда
    "GDP": 120,                                       # advance ~месяц после квартала
    "BAMLH0A0HYM2": 1, "BAMLC0A0CM": 1,
    "DRTSCILM": 35,                                   # SLOOS ~5 недель после даты квартала
    "SP500": 1, "VIXCLS": 1, "VXVCLS": 1,
    "PAYEMS": 35, "SAHMREALTIME": 35, "UNRATE": 35, "CES0500000003": 35,
    "CCSA": 12,
    "T10Y3M": 1, "DFII10": 1, "T10YIE": 1, "DGS2": 1, "DGS10": 1,
    "CPILFESL": 43,
    "DCOILWTICO": 1,                                  # в проде интрадей-надстройка
    "DTWEXBGS": 4, "DEXJPUS": 1, "DEXCHUS": 1, "DTB3": 1,
}

def asof(s, dates):
    """последнее доступное значение серии s на каждую дату (с учётом лага)."""
    lagged = s.copy()
    return lagged.reindex(lagged.index).asof(dates) if len(lagged) else pd.Series(np.nan, index=dates)

class D:
    """контейнер: серия наблюдений + лаг публикации."""
    def __init__(self, s, lag):
        self.s = s
        self.lag = lag
        # индекс доступности: дата наблюдения + лаг
        self.avail = pd.Series(s.values, index=s.index + pd.Timedelta(days=lag)).sort_index()

    def at(self, dates):
        """значение, доступное на дату (asof по дате доступности)."""
        return self.avail.reindex(self.avail.index.union(dates)).ffill().reindex(dates)

    def obs_asof(self, dates):
        """дата последнего доступного наблюдения на каждую дату."""
        marker = pd.Series(self.s.index, index=self.s.index + pd.Timedelta(days=self.lag)).sort_index()
        m = marker.reindex(marker.index.union(dates)).ffill().reindex(dates)
        return m

def load_all():
    d = {}
    for k in LAGS:
        try:
            d[k] = D(fred(k), LAGS[k])
        except Exception as e:
            print("нет серии", k, e)
    d["SPX"] = D(yahoo("GSPC"), 1)             # полная история ^GSPC (Yahoo)
    try:
        d["BTC"] = D(yahoo("BTCUSD"), 1)
    except Exception:
        d["BTC"] = None
    try:
        d["XAU"] = D(yahoo("GOLD"), 1)         # GC=F с 2000
    except Exception:
        d["XAU"] = None
    d["SP500TR"] = D(yahoo("SP500TR"), 1)
    return d

# ---------- вспомогательные ----------
def delta_days(s, days):
    """серия: значение минус значение days календарных дней назад (по наблюдениям)."""
    prev = s.reindex(s.index - pd.Timedelta(days=days), method="ffill")
    prev.index = s.index
    return s - prev

def ratio_days(s, days):
    prev = s.reindex(s.index - pd.Timedelta(days=days), method="ffill")
    prev.index = s.index
    return (s / prev - 1) * 100

def avail_series(raw_score, lag):
    """перевести серию баллов с датами наблюдений в серию доступности."""
    return pd.Series(raw_score.values, index=raw_score.index + pd.Timedelta(days=lag)).sort_index()

# ---------- построение баллов индикаторов ----------
def build_scores(d, grid, era_fair=False, variants=frozenset()):
    """
    Возвращает DataFrame: по каждому индикатору балл −2..+2 (NaN = нет данных)
    на каждый день grid, плюс вспомогательные состояния для детекторов.
    variants: набор включённых улучшений (строки V1..V8).
    """
    S = {}
    aux = {}

    # --- SOFR − IORB (price, coin) ---
    if "SOFR" in d:
        iorb = pd.concat([d["IOER"].s[:"2021-07-27"], d["IORB"].s["2021-07-28":]]).sort_index() \
            if "IORB" in d and "IOER" in d else (d["IORB"].s if "IORB" in d else None)
        sofr = d["SOFR"].s
        ir = iorb.reindex(sofr.index, method="ffill")
        sp = (sofr - ir) * 100
        sp = sp.dropna()
        sp3 = sp.rolling(3).mean()
        aux["sofr_spread"] = avail_series(sp, 1)
        aux["sofr_spread3"] = avail_series(sp3, 1)
        if "V8" in variants:
            # освобождение кв.-конца: разовый спайк в окне кв.-конца не даёт −2 (симметрия с SRF)
            qtr = pd.Series(sp.index.map(lambda t: (t.month in (3, 6, 9, 12) and t.day >= 26) or
                                                    (t.month in (1, 4, 7, 10) and t.day <= 3)),
                            index=sp.index)
            eff = sp.where(~(qtr & (sp3 <= 10)), np.minimum(sp, sp3))
        else:
            eff = sp
        sc = pd.Series(np.select([eff < 0, eff < 5, eff < 10, eff < 15], [2, 1, 0, -1], -2),
                       index=sp.index, dtype=float)
        S["sofr_iorb"] = avail_series(sc, 1)

    # --- чистая ликвидность (qty, lead) ---
    if all(k in d for k in ("WALCL", "WTREGEN", "RRPONTSYD")):
        w = d["WALCL"].s / 1000.0                       # $млрд
        tga_raw = d["WTREGEN"].s
        tga = tga_raw.where(tga_raw <= 2500, tga_raw / 1000.0)   # величинная развилка панели
        rrp = d["RRPONTSYD"].s
        tg = tga.reindex(w.index, method="ffill")
        rp = rrp.reindex(w.index, method="ffill").fillna(0.0)
        nl = (w - tg - rp) / 1000.0                     # $трлн
        nl = nl.dropna()
        chg = ratio_days(nl, 91)
        sc = pd.Series(np.select([chg > 1.5, chg > 0, chg > -1.5, chg > -4], [2, 1, 0, -1], -2),
                       index=nl.index, dtype=float)
        sc[chg.isna()] = np.nan
        S["netliq"] = avail_series(sc.dropna(), 2)

    # --- резервы, % ВВП (qty, coin) — только эпоха «изобилия резервов» (с 2009) ---
    if "WRESBAL" in d and "GDP" in d:
        rb_raw = d["WRESBAL"].s
        rb = rb_raw.where(rb_raw <= 100000, rb_raw / 1000.0)
        gdp = d["GDP"].s
        gdp_avail = pd.Series(gdp.values, index=gdp.index + pd.Timedelta(days=120)).sort_index()
        g = gdp_avail.reindex(rb.index, method="ffill")
        v = (rb / g * 100).dropna()
        v = v[v.index >= "2009-01-01"]
        if "V5" in variants:
            sc = pd.Series(np.select([v > 11, v > 10, v > 9.5, v > 9], [2, 1, 0, -1], -2),
                           index=v.index, dtype=float)
        else:
            sc = pd.Series(np.select([v > 11, v > 10, v > 9], [2, 1, -1], -2),
                           index=v.index, dtype=float)
        S["reserves"] = avail_series(sc, 2)

    # --- TGA Δ4 нед (qty, lead) ---
    if "WTREGEN" in d:
        tga_raw = d["WTREGEN"].s
        tga = tga_raw.where(tga_raw <= 2500, tga_raw / 1000.0)
        chg = delta_days(tga, 28)
        if "V4" in variants:
            sc = pd.Series(np.select([chg < -75, chg < -25, chg < 25, chg < 75], [2, 1, 0, -1], -2),
                           index=tga.index, dtype=float)
        else:
            sc = pd.Series(np.select([chg < -75, chg < 0, chg < 75], [2, 1, -1], -2),
                           index=tga.index, dtype=float)
        sc[chg.isna()] = np.nan
        S["tga"] = avail_series(sc.dropna(), 2)

    # --- RRP буфер (qty, coin) ---
    if "RRPONTSYD" in d:
        rrp = d["RRPONTSYD"].s
        sc = pd.Series(np.select([rrp > 300, rrp > 50], [1, 0], 0), index=rrp.index, dtype=float)
        S["rrp"] = avail_series(sc, 1)

    # --- NFCI ---
    if "NFCI" in d:
        v = d["NFCI"].s
        sc = pd.Series(np.select([v < -0.3, v < 0, v < 0.5], [1, 0, -1], -2), index=v.index, dtype=float)
        S["nfci"] = avail_series(sc, 5)

    # --- SRF (price, coin): RPONTSYD с сент-2019 ---
    if "RPONTSYD" in d:
        srf = d["RPONTSYD"].s[d["RPONTSYD"].s.index >= "2019-09-01"]
        if len(srf):
            days25 = (srf > 25).rolling(3).sum()
            qtr = pd.Series(srf.index.map(lambda t: (t.month in (3, 6, 9, 12) and t.day >= 26) or
                                                     (t.month in (1, 4, 7, 10) and t.day <= 3)),
                            index=srf.index)
            zi = np.select([srf < 1, srf < 25, qtr & (days25 < 2)], [1, 0, -1], -2)
            sc = pd.Series(zi, index=srf.index, dtype=float)
            S["srf"] = avail_series(sc, 1)
            aux["srf_last"] = avail_series(srf, 1)
            aux["srf_days25"] = avail_series(days25, 1)
            aux["srf_qtr"] = avail_series(qtr.astype(float), 1)

    # --- вола ставок (price, lead) ---
    if "DGS10" in d:
        y = d["DGS10"].s
        diffs = y.diff() * 100
        sd = diffs.rolling(20).std(ddof=0)
        aux["ratevol"] = avail_series(sd.dropna(), 1)
        sc = pd.Series(np.select([sd < 2.5, sd < 4, sd < 7, sd < 10], [0, 1, 0, -1], -2),
                       index=y.index, dtype=float)
        sc[sd.isna()] = np.nan
        S["ratevol"] = avail_series(sc.dropna(), 1)

    # --- HY уровень/импульс ---
    if "BAMLH0A0HYM2" in d:
        hy = d["BAMLH0A0HYM2"].s * 100
        aux["hy"] = avail_series(hy, 1)
        sc = pd.Series(np.select([hy < 300, hy < 350, hy < 450], [2, 1, -1], -2), index=hy.index, dtype=float)
        S["hy"] = avail_series(sc, 1)
        mom = delta_days(hy, 30)
        aux["hy_mom"] = avail_series(mom.dropna(), 1)
        sc = pd.Series(np.select([mom <= -25, mom < 0, mom < 25, mom < 75], [2, 1, 0, -1], -2),
                       index=hy.index, dtype=float)
        sc[mom.isna()] = np.nan
        S["hy_mom"] = avail_series(sc.dropna(), 1)

    # --- IG ---
    if "BAMLC0A0CM" in d:
        ig = d["BAMLC0A0CM"].s * 100
        sc = pd.Series(np.select([ig < 100, ig < 130, ig < 160], [2, 1, -1], -2), index=ig.index, dtype=float)
        S["ig"] = avail_series(sc, 1)

    # --- SLOOS ---
    if "DRTSCILM" in d:
        v = d["DRTSCILM"].s
        sc = pd.Series(np.select([v < 0, v < 20, v < 40], [1, 0, -1], -2), index=v.index, dtype=float)
        S["sloos"] = avail_series(sc, 35)

    # --- S&P против 200-дневной + импульс ---
    spx = d["SPX"].s
    sma200 = spx.rolling(200).mean()
    dist = (spx / sma200 - 1) * 100
    rising = sma200 > sma200.shift(10)
    zi = np.select([dist > 12, (dist > 0) & rising, dist > 0, dist > -5], [1, 2, 1, -1], -2)
    sc = pd.Series(zi, index=spx.index, dtype=float)
    sc[dist.isna()] = np.nan
    S["spx"] = avail_series(sc.dropna(), 1)

    mom = ratio_days(spx, 28)
    aux["spx20"] = avail_series(mom.dropna(), 1)
    sc = pd.Series(np.select([mom > 3, mom > -3, mom > -7], [1, 0, -1], -2), index=spx.index, dtype=float)
    sc[mom.isna()] = np.nan
    S["spx_mom"] = avail_series(sc.dropna(), 1)

    # --- VIX ---
    if "VIXCLS" in d:
        vix = d["VIXCLS"].s
        aux["vix"] = avail_series(vix, 1)
        sc = pd.Series(np.select([vix < 13, vix < 20, vix < 26, vix < 35], [0, 1, 0, -1], -2),
                       index=vix.index, dtype=float)
        S["vix"] = avail_series(sc, 1)

    # --- термструктура VIX ---
    if "VIXCLS" in d and "VXVCLS" in d:
        v1 = d["VIXCLS"].s
        v3 = d["VXVCLS"].s
        r = (v1 / v3.reindex(v1.index)).dropna()
        sc = pd.Series(np.select([r < 0.85, r < 1.0, r < 1.05], [0, 1, -1], -2), index=r.index, dtype=float)
        S["vixterm"] = avail_series(sc, 1)

    # --- пейроллы ---
    if "PAYEMS" in d:
        p = d["PAYEMS"].s
        d3 = (p.diff() + p.diff().shift(1) + p.diff().shift(2)) / 3
        sc = pd.Series(np.select([d3 > 120, d3 > 40, d3 > 0], [1, 0, -1], -2), index=p.index, dtype=float)
        sc[d3.isna()] = np.nan
        S["payrolls"] = avail_series(sc.dropna(), 35)

    # --- Sahm ---
    if "SAHMREALTIME" in d:
        v = d["SAHMREALTIME"].s
        aux["sahm"] = avail_series(v, 35)
        sc = pd.Series(np.select([v < 0.2, v < 0.35, v < 0.5], [2, 1, -1], -2), index=v.index, dtype=float)
        S["sahm"] = avail_series(sc, 35)

    # --- длящиеся заявки ---
    if "CCSA" in d:
        c = d["CCSA"].s / 1e6
        avg = c.rolling(26).mean()
        devi = (c / avg - 1) * 100
        if era_fair or "V1" in variants:
            # только относительное правило + мёртвая зона ±2%
            sc = pd.Series(np.select([devi > 5, devi > 2, devi > -2], [-2, -1, 0], 1),
                           index=c.index, dtype=float)
        else:
            sc = pd.Series(np.select([(c > 2.05) | (devi > 5), devi > 0], [-2, -1], 1),
                           index=c.index, dtype=float)
        sc[devi.isna()] = np.nan
        S["claims"] = avail_series(sc.dropna(), 12)

    # --- кривая ---
    if "T10Y3M" in d:
        cv = d["T10Y3M"].s * 100
        min1y = cv.rolling(260).min()
        six = cv.reindex(cv.index - pd.Timedelta(days=182), method="ffill")
        six.index = cv.index
        resteep = cv - six
        g2chg = None
        if "DGS2" in d:
            g2 = d["DGS2"].s
            g6 = delta_days(g2, 182) * 100
            g2chg = g6.reindex(cv.index, method="ffill")
        cond_inv = cv < 0
        cond_rest = (min1y < 0) & (resteep > 80) & ~cond_inv
        bull = cond_rest & (g2chg < -40) if g2chg is not None else cond_rest & False
        bear = cond_rest & ~bull
        cond_exit = (min1y < 0) & ~cond_inv & ~cond_rest
        sc = pd.Series(1.0, index=cv.index)
        sc[cond_exit] = -1
        sc[bear] = -1
        sc[bull] = -2
        sc[cond_inv] = -1
        sc[min1y.isna()] = np.nan
        S["curve"] = avail_series(sc.dropna(), 1)

    # --- реальная 10-летка ---
    if "DFII10" in d:
        rr = d["DFII10"].s
        chg60 = delta_days(rr, 60) * 100
        chg30 = delta_days(rr, 30) * 100
        aux["real10chg30"] = avail_series(chg30.dropna(), 1)
        spx20_obs = ratio_days(spx, 28).reindex(rr.index, method="ffill")
        if "V2" in variants:
            up = chg60 > 40
            down_ok = (chg60 < -40) & (spx20_obs > -3)
            sc = pd.Series(0.0, index=rr.index)
            sc[down_ok] = 1
            sc[up] = -1
        else:
            sc = pd.Series(np.select([chg60 < -40, chg60 > 40], [1, -1], 0), index=rr.index, dtype=float)
        sc[chg60.isna()] = np.nan
        S["real10"] = avail_series(sc.dropna(), 1)

    # --- иена ---
    if "DEXJPUS" in d:
        j = d["DEXJPUS"].s
        chg30 = delta_days(j, 30)
        if era_fair:
            cond2 = chg30 < -8
            cond1 = chg30 < -4
        else:
            cond2 = (chg30 < -8) | (j < 152)
            cond1 = (chg30 < -4) | (j < 158)
        sc = pd.Series(0.0, index=j.index)
        sc[cond1] = -1
        sc[cond2] = -2
        sc[chg30.isna()] = np.nan
        S["jpy"] = avail_series(sc.dropna(), 1)
        aux["jpy_unwind"] = avail_series(cond2.astype(float), 1)

    # --- золото × реальные ставки ---
    if d.get("XAU") is not None and "DFII10" in d:
        g = d["XAU"].s
        gchg = ratio_days(g, 30)
        r30 = (delta_days(d["DFII10"].s, 30) * 100).reindex(g.index, method="ffill")
        sp20 = ratio_days(spx, 28).reindex(g.index, method="ffill")
        sc = pd.Series(0.0, index=g.index)
        sc[(gchg > 2)] = 1                                  # рост при падающей реальной
        sc[(gchg > 2) & (r30 > 10)] = -1                    # дебейсмент
        sc[(gchg < -6) & (sp20 < -3)] = -1                  # маржин-волна
        sc[gchg.isna() | r30.isna()] = np.nan
        S["goldreal"] = avail_series(sc.dropna(), 1)

    # --- биткоин ---
    if d.get("BTC") is not None and "VIXCLS" in d:
        b = d["BTC"].s
        dd = (b / b.rolling(90, min_periods=30).max() - 1) * 100
        vixo = d["VIXCLS"].s.reindex(b.index, method="ffill")
        calm = vixo < 20
        sc = pd.Series(np.nan, index=b.index)
        sc[dd > -10] = 1
        sc[(dd <= -10) & (dd > -25) & calm] = -1
        sc[(dd <= -10) & (dd > -25) & ~calm] = 0
        sc[(dd <= -25) & (dd > -40)] = -1
        sc[dd <= -40] = -2
        sc = sc[sc.index >= "2011-01-01"]
        S["btc"] = avail_series(sc.dropna(), 1)

    # --- стагфляционный флаг ---
    if "T10YIE" in d:
        be = d["T10YIE"].s
        chg = delta_days(be, 30) * 100
        sp20 = ratio_days(spx, 28).reindex(be.index, method="ffill")
        bad = (chg > 15) & (sp20 < 0)
        sc = pd.Series(0.0, index=be.index)
        sc[bad] = -1
        sc[chg.isna()] = np.nan
        S["stagf"] = avail_series(sc.dropna(), 1)
        aux["stagf_on"] = avail_series(bad.astype(float), 1)

    # --- нефть ---
    if "DCOILWTICO" in d:
        o = d["DCOILWTICO"].s
        chg30 = ratio_days(o, 30)
        if era_fair and "CPILFESL" in d:
            cpi = d["CPILFESL"].s
            defl = (cpi / cpi.iloc[-1]).reindex(o.index, method="ffill")
            hi, mid, low = 95 * defl, 85 * defl, 80 * defl
        else:
            hi, mid, low = 95.0, 85.0, 80.0
        sp20 = ratio_days(spx, 28).reindex(o.index, method="ffill")
        shock = (o > hi) | (chg30 > 25)
        crash = chg30 < -20
        sc = pd.Series(0.0, index=o.index)
        sc[o > low] = -1
        sc[crash & (sp20 > -3)] = 1
        sc[crash & (sp20 <= -3)] = 0
        sc[shock] = -2
        sc[chg30.isna()] = np.nan
        S["oil"] = avail_series(sc.dropna(), 1)
        aux["wti"] = avail_series(o, 1)
        aux["wti_chg30"] = avail_series(chg30.dropna(), 1)
        aux["oil_hi"] = avail_series(hi if isinstance(hi, pd.Series) else pd.Series(hi, index=o.index), 1)
        aux["oil_mid"] = avail_series(mid if isinstance(mid, pd.Series) else pd.Series(mid, index=o.index), 1)

    # --- юань ---
    if "DEXCHUS" in d:
        c = d["DEXCHUS"].s
        chg = ratio_days(c, 60)
        sc = pd.Series(np.select([chg < -1.5, chg < 2, chg < 3.5], [1, 0, -1], -2), index=c.index, dtype=float)
        sc[chg.isna()] = np.nan
        S["cny"] = avail_series(sc.dropna(), 1)

    # --- доллар ---
    if "DTWEXBGS" in d:
        x = d["DTWEXBGS"].s
        chg = ratio_days(x, 60)
        sc = pd.Series(np.select([chg < -3, chg < 3, chg < 5], [1, 0, -1], -2), index=x.index, dtype=float)
        sc[chg.isna()] = np.nan
        S["dxy"] = avail_series(sc.dropna(), 4)
        aux["dxy_chg60"] = avail_series(chg.dropna(), 4)

    # --- серии для детекторов: инфляция и разворот ---
    if "CPILFESL" in d:
        cpi = d["CPILFESL"].s
        yoy = (cpi / cpi.shift(12) - 1) * 100
        aux["cpi_yoy"] = avail_series(yoy.dropna(), 43)
        aux["cpi_yoy_prev"] = avail_series(yoy.shift(3).dropna(), 43)
    if "CES0500000003" in d:
        wg = d["CES0500000003"].s
        wyoy = (wg / wg.shift(12) - 1) * 100
        wup = (wyoy >= wyoy.shift(3) - 0.05)
        aux["wage_up"] = avail_series(wup.astype(float).dropna(), 35)
    if "DGS2" in d:
        g2 = d["DGS2"].s
        aux["dgs2_chg60"] = avail_series((delta_days(g2, 60) * 100).dropna(), 1)

    # --- сборка на дневную сетку ---
    df = pd.DataFrame(index=grid)
    for k, s in S.items():
        s = s[~s.index.duplicated(keep="last")]
        df[k] = s.reindex(s.index.union(grid)).ffill().reindex(grid)
    A = pd.DataFrame(index=grid)
    for k, s in aux.items():
        s = s[~s.index.duplicated(keep="last")]
        A[k] = s.reindex(s.index.union(grid)).ffill().reindex(grid)
    return df, A

# ---------- структура панели ----------
FAM = {  # индикатор -> (блок, семья, lead)
    "sofr_iorb": ("plumb", "price", False),
    "netliq":    ("plumb", "qty",  True),
    "reserves":  ("plumb", "qty",  False),
    "tga":       ("plumb", "qty",  True),
    "rrp":       ("plumb", "qty",  False),
    "nfci":      ("plumb", "nfci", False),
    "srf":       ("plumb", "price", False),
    "ratevol":   ("plumb", "price", True),
    "hy":        ("credit", "hy", False),
    "hy_mom":    ("credit", "hy", True),
    "ig":        ("credit", "ig", False),
    "sloos":     ("credit", "sloos", True),
    "spx":       ("market", "spx", False),
    "spx_mom":   ("market", "spx", False),
    "vix":       ("market", "vix", False),
    "vixterm":   ("market", "vixterm", True),
    "payrolls":  ("macro", "payrolls", False),
    "sahm":      ("macro", "sahm", False),
    "claims":    ("macro", "claims", True),
    "curve":     ("macro", "curve", True),
    "real10":    ("macro", "real10", False),
    "jpy":       ("regime", "jpy", True),
    "goldreal":  ("regime", "goldreal", True),
    "btc":       ("regime", "btc", True),
    "stagf":     ("regime", "stagf", True),
    "oil":       ("regime", "oil", True),
    "cny":       ("regime", "cny", True),
    "dxy":       ("regime", "dxy", True),
}
W = {"plumb": 25, "credit": 25, "market": 20, "macro": 15, "regime": 15}

def composite(df, A, variants=frozenset()):
    """блочная агрегация по семьям + детекторы; возвращает DataFrame с composite, lead, coin, detpts."""
    fam_credit = dict(hy=("hy", "spread"), hy_mom=("hy", "mom"), ig=("ig", "spread"), sloos=("sloos", "sloos"))
    blocks = {}
    for b in W:
        inds = [k for k, v in FAM.items() if v[0] == b and k in df.columns]
        fams = {}
        for k in inds:
            f = FAM[k][1]
            if "V3" in variants and b == "credit":
                f = {"hy": "lvl", "ig": "lvl", "hy_mom": "mom", "sloos": "sloos"}[k]
            fams.setdefault(f, []).append(k)
        fmeans = []
        for f, ks in fams.items():
            fmeans.append(df[ks].mean(axis=1))          # NaN игнорируются внутри семьи
        fm = pd.concat(fmeans, axis=1)
        blocks[b] = fm.mean(axis=1) / 2 * 100
    B = pd.DataFrame(blocks)
    wsum = sum(W[b] for b in B.columns)
    comp = sum(B[b].fillna(0) * W[b] for b in B.columns)
    # вес только присутствующих блоков в каждый день
    wpres = sum(B[b].notna() * W[b] for b in B.columns)
    comp = sum((B[b] * W[b]).fillna(0) for b in B.columns) / wpres.replace(0, np.nan)

    # lead/coin по семьям|половинам
    gf = {}
    for k, (b, f, lead) in FAM.items():
        if k not in df.columns:
            continue
        gf.setdefault((f, lead), []).append(k)
    lead_means, coin_means = [], []
    for (f, lead), ks in gf.items():
        m = df[ks].mean(axis=1)
        (lead_means if lead else coin_means).append(m)
    leadS = pd.concat(lead_means, axis=1).mean(axis=1) / 2 * 100
    coinS = pd.concat(coin_means, axis=1).mean(axis=1) / 2 * 100

    # покрытие
    cover = df.notna().sum(axis=1) / len([k for k in FAM if k in df.columns])

    # --- детекторы ---
    pts = pd.Series(0.0, index=df.index)
    det_fund = pd.Series(False, index=df.index)

    sp = A.get("sofr_spread")
    sp3 = A.get("sofr_spread3")
    srf_last = A.get("srf_last")
    srf_days25 = A.get("srf_days25")
    srf_qtr = A.get("srf_qtr")
    if sp is not None:
        f_sp = (sp > 15) | (sp3 > 10)
        if "V8" in variants:
            qtrmask = pd.Series(df.index.map(lambda t: (t.month in (3, 6, 9, 12) and t.day >= 26) or
                                                        (t.month in (1, 4, 7, 10) and t.day <= 5)),
                                index=df.index)
            f_sp = ((sp > 15) & ~qtrmask) | (sp3 > 10)
        w_sp = sp > 5
    else:
        f_sp = pd.Series(False, index=df.index); w_sp = f_sp
    if srf_last is not None:
        f_srf = (srf_days25 >= 2) | ((srf_last > 25) & (srf_qtr < 0.5))
        w_srf = srf_last > 5
    else:
        f_srf = pd.Series(False, index=df.index); w_srf = f_srf
    fund_fired = (f_sp.fillna(False) | f_srf.fillna(False))
    fund_watch = (w_sp.fillna(False) | w_srf.fillna(False)) & ~fund_fired
    pts += np.where(fund_fired, -10, np.where(fund_watch, -3, 0))
    det_fund = fund_fired

    wti = A.get("wti"); wchg = A.get("wti_chg30")
    if wti is not None:
        ohi = A.get("oil_hi", pd.Series(95.0, index=df.index))
        omid = A.get("oil_mid", pd.Series(85.0, index=df.index))
        o_f = (wti > ohi) | (wchg > 25)
        o_w = ((wti > omid) | (wchg > 15)) & ~o_f
        pts += np.where(o_f.fillna(False), -10, np.where(o_w.fillna(False), -4, 0))

    # инфляционный узел
    cy = A.get("cpi_yoy"); cyp = A.get("cpi_yoy_prev"); wup = A.get("wage_up")
    if cy is not None:
        wu = wup.fillna(1.0) if wup is not None else pd.Series(1.0, index=df.index)
        i_f = (cy > 3.5) & (wu > 0.5)
        i_w = (cy > 3.2) & (cy >= cyp) & ~i_f
        pts += np.where(i_f.fillna(False), -8, np.where(i_w.fillna(False), -3, 0))

    # разворот ФРС при спокойном кредите
    g2c = A.get("dgs2_chg60"); hyv = A.get("hy"); vixv = A.get("vix"); rvol = A.get("ratevol")
    if g2c is not None and hyv is not None:
        vv = vixv if vixv is not None else pd.Series(99.0, index=df.index)
        rv = rvol if rvol is not None else pd.Series(0.0, index=df.index)
        panic = (g2c <= -50) & ((hyv >= 450) | (rv > 10))
        good = (g2c <= -50) & (hyv < 400) & (vv < 30) & ~panic
        watch = (g2c <= -30) & (hyv < 420) & ~good & ~panic
        pts += np.where(good.fillna(False), 10, np.where(watch.fillna(False), 4, 0))

    # V7: триада разворота (вход после дна) — механизация документированного правила панели:
    # «спреды перестали расширяться + доллар развернулся» после стрессового уровня спредов
    if "V7" in variants and hyv is not None:
        hym = A.get("hy_mom"); dxc = A.get("dxy_chg60")
        spx_m = df.get("spx_mom")
        if hym is not None and dxc is not None:
            stressed = hyv.rolling(90, min_periods=10).max() > 450     # рынок был в стрессе за посл. квартал
            turn = stressed & (hym <= 0) & (dxc < -1) & (spx_m >= 0 if spx_m is not None else True)
            pts += np.where(turn.fillna(False), 10, 0)

    out = pd.DataFrame({"comp_raw": comp, "lead": leadS, "coin": coinS,
                        "cover": cover, "detpts": pts, "fund_fired": det_fund.astype(float)})
    out["composite"] = (out["comp_raw"] + out["detpts"]).clip(-100, 100)
    return out

VERDICTS = ["PROTECT", "REDUCE", "HOLD", "HOLD+", "BUY"]

def verdict_series(out, gate=True):
    """вердикт панели с гейтом опережающих."""
    s = out["composite"]; lead = out["lead"]
    v = pd.Series("HOLD", index=out.index, dtype=object)
    v[s >= 30] = "BUY"
    v[(s >= 10) & (s < 30)] = "HOLD+"
    v[(s <= -10) & (s > -30)] = "REDUCE"
    v[s <= -30] = "PROTECT"
    if gate:
        v[(v == "BUY") & (lead < 10)] = "HOLD+"
        v[(v == "PROTECT") & (lead > -10)] = "REDUCE"
    v[out["cover"] < 0.6] = "NA"
    return v
