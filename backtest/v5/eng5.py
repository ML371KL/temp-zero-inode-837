"""v5 research engine: live v4.15.1 logic + switchable candidate changes + 3-rung ladder machine.

Live baseline = loader.CURRENT variants + era_fair (claims relative, yen Δ30 only, oil CPI-indexed)
+ VIX scored by its 30-day change (v4.14).
Each candidate change is a flag; build(flags) returns (sig, df, A) with composite/lead/coin/detpts.
"""
import os, sys, pickle
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import loader as L
E = L.E

CACHE = os.path.join(HERE, "cache5")
os.makedirs(CACHE, exist_ok=True)

def _grid_series(s, grid):
    s = s[~s.index.duplicated(keep="last")].sort_index()
    return s.reindex(s.index.union(grid)).ffill().reindex(grid)

def _avail(s, lag):
    return pd.Series(s.values, index=s.index + pd.Timedelta(days=lag)).sort_index()

def _rank_pct(s, win):
    return s.rolling(win, min_periods=int(win * 0.6)).apply(lambda x: (x[:-1] < x[-1]).mean() * 100, raw=True)

# ---------------------------------------------------------------------------
def live_scores(d, grid):
    df, A = E.build_scores(d, grid, era_fair=True, variants=L.CURRENT)
    # v4.14: VIX by 30-calendar-day change
    vix = d["VIXCLS"].s
    ch = E.delta_days(vix, 30)
    sc = pd.Series(np.select([ch > 10, ch > 5, ch >= -5], [-2, -1, 0], 1), index=vix.index, dtype=float)
    sc[ch.isna()] = np.nan
    df["vix"] = _grid_series(_avail(sc.dropna(), 1), grid)
    A["vix_chg30"] = _grid_series(_avail(ch.dropna(), 1), grid)
    return df, A

# ---------------------------- candidate modifiers ---------------------------
def m_oil_rel(df, A, d, grid):
    """oil card: shock relative to its own 1-year mean instead of a CPI-indexed level."""
    o = d["DCOILWTICO"].s
    o = o[o > 0]
    m = o.rolling(252, min_periods=150).mean()
    ratio = o / m
    chg30 = E.ratio_days(o, 30)
    spx = d["SPX"].s
    sp20 = E.ratio_days(spx, 28).reindex(o.index, method="ffill")
    sc = pd.Series(0.0, index=o.index)
    sc[ratio > 1.15] = -1
    sc[(chg30 < -20) & (sp20 > -3)] = 1
    sc[(ratio > 1.30) | ((chg30 > 25) & (ratio > 1.10))] = -2
    sc[ratio.isna()] = np.nan
    df["oil"] = _grid_series(_avail(sc.dropna(), 1), grid)
    A["oil_ratio"] = _grid_series(_avail(ratio.dropna(), 1), grid)
    A["oil_chg30r"] = _grid_series(_avail(chg30.dropna(), 1), grid)
    return df

def m_ig_fuse(df, A, d, grid):
    """IG: +2 only when spreads are low AND not widening (Δ30 ≤ +10bp); zero band 120–140."""
    ig = d["BAMLC0A0CM"].s * 100
    mom = E.delta_days(ig, 30)
    sc = pd.Series(np.select([(ig < 100) & (mom <= 10), ig < 120, ig < 140, ig < 160], [2, 1, 0, -1], -2),
                   index=ig.index, dtype=float)
    df["ig"] = _grid_series(_avail(sc, 1), grid)
    return df

def m_ig_pct(df, A, d, grid):
    """IG: average of absolute zone and 3-year percentile zone."""
    ig = d["BAMLC0A0CM"].s * 100
    absz = pd.Series(np.select([ig < 100, ig < 130, ig < 160], [2, 1, -1], -2), index=ig.index, dtype=float)
    p = _rank_pct(ig, 756)
    pz = pd.Series(np.select([p < 20, p < 50, p < 80, p < 95], [1, 0.5, 0, -1], -2), index=ig.index, dtype=float)
    sc = ((absz + pz.fillna(absz)) / 2).round()
    df["ig"] = _grid_series(_avail(sc, 1), grid)
    return df

def m_hy_zb(df, A, d, grid):
    """HY level: zero band 340–360 instead of the +1 → −1 cliff at 350."""
    hy = d["BAMLH0A0HYM2"].s * 100
    sc = pd.Series(np.select([hy < 300, hy < 340, hy < 360, hy < 450], [2, 1, 0, -1], -2), index=hy.index, dtype=float)
    df["hy"] = _grid_series(_avail(sc, 1), grid)
    return df

def m_spx_zb(df, A, d, grid):
    """S&P vs 200d: ±1% zero band around the average instead of +2 → −1 cliff."""
    spx = d["SPX"].s
    sma = spx.rolling(200).mean()
    dist = (spx / sma - 1) * 100
    rising = sma > sma.shift(10)
    zi = np.select([dist > 12, (dist > 1) & rising, dist > 1, dist >= -1, dist > -5], [1, 2, 1, 0, -1], -2)
    sc = pd.Series(zi, index=spx.index, dtype=float)
    sc[dist.isna()] = np.nan
    df["spx"] = _grid_series(_avail(sc.dropna(), 1), grid)
    return df

def m_nfci_rel(df, A, d, grid):
    """NFCI: deviation from its own 3-year mean; level > 0 stays a crisis flag."""
    v = d["NFCI"].s
    z = v - v.rolling(156, min_periods=100).mean()
    sc = pd.Series(np.select([v > 0, z > 0.4, z > 0.15, z > -0.15], [-2, -2, -1, 0], 1), index=v.index, dtype=float)
    sc[z.isna()] = np.nan
    df["nfci"] = _grid_series(_avail(sc.dropna(), 5), grid)
    return df

def m_curve_deep(df, A, d, grid):
    """curve: 'was inverted' requires ≥20 sessions at ≤ −10bp within the last 260 sessions."""
    cv = d["T10Y3M"].s * 100
    deep = (cv <= -10).astype(float).rolling(260).sum()
    min1y = cv.rolling(260).min()
    six = cv.reindex(cv.index - pd.Timedelta(days=182), method="ffill"); six.index = cv.index
    resteep = cv - six
    g6 = E.delta_days(d["DGS2"].s, 182) * 100
    g2chg = g6.reindex(cv.index, method="ffill")
    was_inv = deep >= 20
    cond_inv = cv < 0
    cond_rest = was_inv & (resteep > 80) & ~cond_inv
    bull = cond_rest & (g2chg < -40)
    bear = cond_rest & ~bull
    cond_exit = was_inv & ~cond_inv & ~cond_rest
    sc = pd.Series(1.0, index=cv.index)
    sc[cond_exit] = -1; sc[bear] = -1; sc[bull] = -2; sc[cond_inv] = -1
    sc[min1y.isna()] = np.nan
    df["curve"] = _grid_series(_avail(sc.dropna(), 1), grid)
    return df

def m_tga_wide(df, A, d, grid):
    """TGA Δ4w: neutral band ±100bn (typical 4-week move is 100–140bn)."""
    t = d["WTREGEN"].s
    t = t.where(t <= 2500, t / 1000.0)
    chg = E.delta_days(t, 28)
    sc = pd.Series(np.select([chg < -200, chg < -100, chg < 100, chg < 200], [2, 1, 0, -1], -2), index=t.index, dtype=float)
    sc[chg.isna()] = np.nan
    df["tga"] = _grid_series(_avail(sc.dropna(), 2), grid)
    return df

def m_tga_drop(df, A, d, grid):
    df["tga"] = np.nan
    return df

def m_sofr(df, A, d, grid):
    """SOFR−IORB: 3-day mean, scale shifted so that SOFR at/above IORB is not a plus."""
    if "SOFR" not in d: return df
    iorb = pd.concat([d["IOER"].s[:"2021-07-27"], d["IORB"].s["2021-07-28":]]).sort_index()
    sofr = d["SOFR"].s
    sp = ((sofr - iorb.reindex(sofr.index, method="ffill")) * 100).dropna()
    sp3 = sp.rolling(3).mean()
    sc = pd.Series(np.select([sp3 <= -8, sp3 <= -3, sp3 <= 3, sp3 <= 10], [2, 1, 0, -1], -2), index=sp.index, dtype=float)
    sc[sp3.isna()] = np.nan
    df["sofr_iorb"] = _grid_series(_avail(sc.dropna(), 1), grid)
    return df

def m_regime_ctx(df, A, d, grid):
    """regime cards: signs conditional on stress context."""
    spx = d["SPX"].s
    sp20 = E.ratio_days(spx, 28)
    # goldreal: +1 only when equities are not falling
    if "goldreal" in df:
        s20 = _grid_series(_avail(sp20.dropna(), 1), grid)
        g = df["goldreal"].copy()
        g[(g == 1) & (s20 < 0)] = 0
        df["goldreal"] = g
    # yen: −2 only with market stress (VIX Δ30 > +5 or S&P 4w < −3%)
    if "jpy" in df:
        j = df["jpy"].copy()
        vch = A.get("vix_chg30")
        s20 = _grid_series(_avail(sp20.dropna(), 1), grid)
        calm = ~((vch > 5) | (s20 < -3))
        j[(j == -2) & calm] = -1
        df["jpy"] = j
    # dollar: +1 'reflation' only if HY is not widening
    if "dxy" in df and "hy_mom" in A:
        x = df["dxy"].copy()
        x[(x == 1) & (A["hy_mom"] > 0)] = 0
        df["dxy"] = x
    # stagflation: only when breakevens are above their 1y median
    if "stagf" in df and "T10YIE" in d:
        be = d["T10YIE"].s
        med = be.rolling(252, min_periods=150).median()
        above = _grid_series(_avail((be > med).astype(float), 1), grid)
        s = df["stagf"].copy()
        s[(s == -1) & (above < 0.5)] = 0
        df["stagf"] = s
    return df

def m_policy(df, A, d, grid):
    """new macro card: 2y yield minus Fed target (upper). Market pricing a hiking cycle = headwind."""
    tgt = pd.concat([d["DFEDTAR"].s[:"2008-12-15"], d["DFEDTARU"].s["2008-12-16":]]).sort_index() if "DFEDTAR" in d else d["DFEDTARU"].s
    g2 = d["DGS2"].s
    gap = (g2 - tgt.reindex(g2.index, method="ffill")) * 100
    gap = gap.dropna()
    sc = pd.Series(np.select([gap > 100, gap > 50, gap > -150], [-2, -1, 0], 0), index=gap.index, dtype=float)
    df["policy"] = _grid_series(_avail(sc, 1), grid)
    A["policy_gap"] = _grid_series(_avail(gap, 1), grid)
    return df

def m_real_level(df, A, d, grid):
    """real10: add level component: real 10y in top decile of its 10y history = −1 (valuation pressure)."""
    rr = d["DFII10"].s
    p = _rank_pct(rr, 2520)
    s = df["real10"].copy()
    lev = _grid_series(_avail(p.dropna(), 1), grid)
    s[(lev > 90) & (s >= 0)] = -1
    df["real10"] = s
    return df

def m_oil_off(df, A, d, grid):
    """oil card out of the composite (context only); the relative shock detector carries oil."""
    m_oil_rel(df, A, d, grid)
    df["oil"] = np.nan
    return df

MODS = {"OIL": m_oil_rel, "OIL2": m_oil_off, "IGF": m_ig_fuse, "IGP": m_ig_pct, "HYZ": m_hy_zb, "SPZ": m_spx_zb, "NFR": m_nfci_rel,
        "CRV": m_curve_deep, "TGW": m_tga_wide, "TGD": m_tga_drop, "SOF": m_sofr, "RGC": m_regime_ctx,
        "POL": m_policy, "RRL": m_real_level}

FAM5 = dict(E.FAM)
FAM5["policy"] = ("macro", "policy", True)

# ------------------------------- composite ---------------------------------
def composite5(df, A, flags):
    fam = dict(FAM5)
    if "HMF" in flags:                       # HY momentum as its own family
        fam["hy_mom"] = ("credit", "hymom", True)
    if "NFQ" in flags:                       # NFCI folded into the price-of-funding family
        fam["nfci"] = ("plumb", "price", False)
    blocks = {}
    for b in E.W:
        inds = [k for k, v in fam.items() if v[0] == b and k in df.columns]
        fams = {}
        for k in inds:
            fams.setdefault(fam[k][1], []).append(k)
        fm = [df[ks].mean(axis=1) for ks in fams.values()]
        if fm:
            blocks[b] = pd.concat(fm, axis=1).mean(axis=1) / 2 * 100
    B = pd.DataFrame(blocks)
    wpres = sum(B[b].notna() * E.W[b] for b in B.columns)
    comp = sum((B[b] * E.W[b]).fillna(0) for b in B.columns) / wpres.replace(0, np.nan)

    # leading / confirming
    gf = {}
    for k, (b, f, lead) in fam.items():
        if k in df.columns:
            gf.setdefault((b, f, lead), []).append(k)
    if "LDW" in flags:                       # leading = block-weighted mean of block-level leading means
        lb, cb = {}, {}
        for (b, f, lead), ks in gf.items():
            (lb if lead else cb).setdefault(b, []).append(df[ks].mean(axis=1))
        def wmean(dct):
            num = 0; den = 0
            for b, lst in dct.items():
                m = pd.concat(lst, axis=1).mean(axis=1)
                num = num + (m * E.W[b]).fillna(0); den = den + m.notna() * E.W[b]
            return num / den.replace(0, np.nan) / 2 * 100
        leadS, coinS = wmean(lb), wmean(cb)
    else:
        lm = [df[ks].mean(axis=1) for (b, f, lead), ks in gf.items() if lead]
        cm = [df[ks].mean(axis=1) for (b, f, lead), ks in gf.items() if not lead]
        leadS = pd.concat(lm, axis=1).mean(axis=1) / 2 * 100
        coinS = pd.concat(cm, axis=1).mean(axis=1) / 2 * 100
    ncards = len([k for k in fam if k in df.columns])
    cover = df[[k for k in fam if k in df.columns]].notna().sum(axis=1) / ncards

    pts = pd.Series(0.0, index=df.index)
    # funding detector (as live: one-day trigger outside quarter-end; FUN flag = needs persistence)
    sp, sp3 = A.get("sofr_spread"), A.get("sofr_spread3")
    srf_last, srf_days25, srf_qtr = A.get("srf_last"), A.get("srf_days25"), A.get("srf_qtr")
    qtrmask = pd.Series(df.index.map(lambda t: (t.month in (3, 6, 9, 12) and t.day >= 26) or (t.month in (1, 4, 7, 10) and t.day <= 5)), index=df.index)
    if sp is not None:
        f_sp = ((sp > 15) & ~qtrmask) | (sp3 > 10)
        w_sp = sp > 5
    else:
        f_sp = w_sp = pd.Series(False, index=df.index)
    if srf_last is not None:
        f_srf = (srf_days25 >= 2) | ((srf_last > 25) & (srf_qtr < 0.5))
        w_srf = srf_last > 5
    else:
        f_srf = w_srf = pd.Series(False, index=df.index)
    fund_fired = f_sp.fillna(False) | f_srf.fillna(False)
    fund_watch = (w_sp.fillna(False) | w_srf.fillna(False)) & ~fund_fired
    pts += np.where(fund_fired, -10, np.where(fund_watch, -3, 0))

    # oil detector
    if "OIL1" in flags:
        pass                                  # oil counted once: card only
    elif ("OIL" in flags or "OIL2" in flags) and "oil_ratio" in A:
        r = A["oil_ratio"]; c = A["oil_chg30r"]
        o_f = (r > 1.30) | ((c > 25) & (r > 1.10))
        o_w = ((r > 1.15) | ((c > 15) & (r > 1.05))) & ~o_f
        pts += np.where(o_f.fillna(False), -10, np.where(o_w.fillna(False), -4, 0))
    else:
        wti, wchg = A.get("wti"), A.get("wti_chg30")
        if wti is not None:
            ohi = A.get("oil_hi"); omid = A.get("oil_mid")
            v_, c_, hi_, mid_ = (x.reindex(df.index).astype(float).values for x in (wti, wchg, ohi, omid))
            st = 0; arr = np.zeros(len(df.index))
            for i in range(len(arr)):
                v, c, h, m = v_[i], c_[i], hi_[i], mid_[i]
                if np.isnan(v) or np.isnan(h):
                    arr[i] = 0 if st == 0 else (-4 if st == 1 else -10); continue
                cc = 0.0 if np.isnan(c) else c
                f_in, w_in = (v > h) or (cc > 25), (v > m) or (cc > 15)
                f_hold = st == 2 and ((v > h * 0.985) or (cc > 25 * 0.94))
                w_hold = st >= 1 and ((v > m * 0.985) or (cc > 15 * 0.94))
                st = 2 if (f_in or f_hold) else (1 if (w_in or w_hold) else 0)
                arr[i] = -10 if st == 2 else (-4 if st == 1 else 0)
            pts += arr

    # inflation knot
    cy, cyp, wup = A.get("cpi_yoy"), A.get("cpi_yoy_prev"), A.get("wage_up")
    if cy is not None:
        wu = wup.fillna(1.0) if wup is not None else pd.Series(1.0, index=df.index)
        i_f = (cy > 3.5) & (wu > 0.5)
        i_w = (cy > 3.2) & (cy >= cyp) & ~i_f
        pts += np.where(i_f.fillna(False), -8, np.where(i_w.fillna(False), -3, 0))

    # Fed pivot (easing with calm credit) and its hawkish mirror (HAWK flag)
    g2c, hyv, vixv, rvol = A.get("dgs2_chg60"), A.get("hy"), A.get("vix"), A.get("ratevol")
    if g2c is not None and hyv is not None:
        vv = vixv if vixv is not None else pd.Series(99.0, index=df.index)
        rv = rvol if rvol is not None else pd.Series(0.0, index=df.index)
        panic = (g2c <= -50) & ((hyv >= 450) | (rv > 10))
        good = (g2c <= -50) & (hyv < 400) & (vv < 30) & ~panic
        watch = (g2c <= -30) & (hyv < 420) & ~good & ~panic
        pts += np.where(good.fillna(False), 10, np.where(watch.fillna(False), 4, 0))
        if "HAWK" in flags:
            hk = (g2c >= 75)
            hw = (g2c >= 50) & ~hk
            pts += np.where(hk.fillna(False), -6, np.where(hw.fillna(False), -3, 0))

    # turn triad (V7)
    hym, dxc = A.get("hy_mom"), A.get("dxy_chg60")
    spx_m = df.get("spx_mom")
    if hyv is not None and hym is not None and dxc is not None:
        stressed = hyv.rolling(90, min_periods=10).max() > 450
        turn = stressed & (hym <= 0) & (dxc < -1) & (spx_m >= 0)
        pts += np.where(turn.fillna(False), 10, 0)

    out = pd.DataFrame({"comp_raw": comp, "lead": leadS, "coin": coinS, "cover": cover, "detpts": pts,
                        "fund_fired": fund_fired.astype(float)})
    out["composite"] = (out["comp_raw"] + out["detpts"]).clip(-100, 100)
    for b in B.columns:
        out["B_" + b] = B[b]
    return out

def hard_market(A, grid):
    hy = A.get("hy", pd.Series(np.nan, index=grid)); hymom = A.get("hy_mom", pd.Series(np.nan, index=grid))
    vix = A.get("vix", pd.Series(np.nan, index=grid)); rvol = A.get("ratevol", pd.Series(0.0, index=grid))
    jpyu = A.get("jpy_unwind", pd.Series(0.0, index=grid))
    return (((hy > 450) & (hymom > 75)).astype(float).fillna(0) + (jpyu > 0.5).astype(float).fillna(0)
            + (vix > 35).astype(float).fillna(0) + (rvol > 10).astype(float).fillna(0))

def build(d, grid, flags=frozenset(), tag=None):
    flags = frozenset(flags)
    key = os.path.join(CACHE, f"s5_{'_'.join(sorted(flags)) or 'live'}_{grid[0].date()}_{grid[-1].date()}.pkl")
    if os.path.exists(key):
        return pickle.load(open(key, "rb"))
    df, A = live_scores(d, grid)
    for f in sorted(flags):
        if f in MODS:
            df = MODS[f](df, A, d, grid)
    if "OIL" in flags and "OIL" not in MODS:
        pass
    out = composite5(df, A, flags)
    out["hardMarket"] = hard_market(A, grid)
    out["fund"] = out["fund_fired"].astype(bool)
    out["override"] = out["fund_fired"].astype(bool) & (out["hardMarket"] >= 2)
    res = (out, df, A)
    pickle.dump(res, open(key, "wb"))
    return res

# --------------------------------- ladders ---------------------------------
def rung3(c, l, T1, T2, G):
    """2 = 100%, 1 = 50%, 0 = 0%. Gate: full defense needs leading ≤ G."""
    if c >= T1: return 2
    if c >= T2: return 1
    return 0 if l <= G else 1

def machine3(sig, T1=-10, T2=-30, G=-10, hyst=3, confirm=True, use_override=True, pct=(0.0, 0.5, 1.0),
             fired=None):
    c_ = sig["composite"].values; l_ = sig["lead"].values; cov = sig["cover"].values; ov = sig["override"].values
    fz = fired if fired is not None else np.zeros(len(c_), bool)
    n = len(c_); cur = None; pend = None
    out = np.empty(n)
    for t in range(n):
        c, l = c_[t], l_[t]
        if use_override and ov[t]:
            cur = 0; pend = None
        elif cov[t] < 0.6 or np.isnan(c):
            cur = 2 if cur is None else cur
        else:
            raw = rung3(c, l, T1, T2, G)
            if cur is None:
                cur = raw
            elif raw != cur:
                tgt = cur + (1 if raw > cur else -1)
                if hyst:
                    if tgt > cur and rung3(c - hyst, l - hyst, T1, T2, G) <= cur: tgt = cur
                    elif tgt < cur and rung3(c + hyst, l + hyst, T1, T2, G) >= cur: tgt = cur
                if fz[t] and tgt > cur: tgt = cur
                if tgt != cur:
                    if (not confirm) or pend == tgt:
                        cur = tgt; pend = None
                    else:
                        pend = tgt
                else:
                    pend = None
            else:
                pend = None
        out[t] = cur
    return pd.Series([pct[int(r)] for r in out], index=sig.index), pd.Series(out, index=sig.index)

def machine5(sig, **kw):
    import harness as H
    return H.ladder_machine(sig, **kw)
