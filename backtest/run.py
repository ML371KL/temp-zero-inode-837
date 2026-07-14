"""Прогон бэктеста: as-built + варианты улучшений, метрики, эпизоды."""
import pandas as pd
import numpy as np
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from engine import load_all, build_scores, composite, verdict_series, FAM

pd.set_option("display.width", 200)

EXPO = {"BUY": 1.0, "HOLD+": 0.85, "HOLD": 0.65, "REDUCE": 0.35, "PROTECT": 0.0, "NA": 0.65}

def perf(verdicts, tr, cash_daily, start, end):
    """стратегия: экспозиция по вердикту, исполнение на следующий день."""
    idx = tr.loc[start:end].index
    expo = verdicts.map(EXPO).reindex(idx).ffill().shift(1).fillna(EXPO["HOLD"])
    r_mkt = tr.pct_change().reindex(idx).fillna(0)
    r_cash = cash_daily.reindex(idx).ffill().fillna(0)
    r = expo * r_mkt + (1 - expo) * r_cash
    eq = (1 + r).cumprod()
    bh = (1 + r_mkt).cumprod()
    yrs = (idx[-1] - idx[0]).days / 365.25
    def stats(x):
        cagr = x.iloc[-1] ** (1 / yrs) - 1
        ret = x.pct_change().dropna()
        vol = ret.std() * np.sqrt(252)
        sharpe = (ret.mean() * 252 - r_cash.mean() * 252) / vol if vol > 0 else 0
        dd = (x / x.cummax() - 1).min()
        return cagr, vol, sharpe, dd
    return dict(zip(["cagr", "vol", "sharpe", "maxdd"], stats(eq))), \
           dict(zip(["cagr", "vol", "sharpe", "maxdd"], stats(bh))), expo.mean(), eq, bh

def fwd_returns(comp, spx, horizon):
    fwd = spx.shift(-horizon) / spx - 1
    both = pd.concat([comp, fwd], axis=1).dropna()
    both.columns = ["c", "f"]
    return both

def main():
    d = load_all()
    spx = d["SPX"].s
    tr = d["SP500TR"].s          # полная доходность с 1988
    grid = spx.loc["2004-01-01":].index
    cash = d["DTB3"].s / 100 / 252
    cash_daily = cash.reindex(grid, method="ffill")

    runs = {
        "as_built":  dict(era_fair=False, variants=frozenset()),
        "era_fair":  dict(era_fair=True,  variants=frozenset()),
        "V1_claims": dict(era_fair=True,  variants=frozenset(["V1"])),
        "V2_real10": dict(era_fair=True,  variants=frozenset(["V2"])),
        "V3_credit": dict(era_fair=True,  variants=frozenset(["V3"])),
        "V4_tga":    dict(era_fair=True,  variants=frozenset(["V4"])),
        "V5_resv":   dict(era_fair=True,  variants=frozenset(["V5"])),
        "V7_reentry":dict(era_fair=True,  variants=frozenset(["V7"])),
        "V8_qtrsofr":dict(era_fair=True,  variants=frozenset(["V8"])),
        "ALL":       dict(era_fair=True,  variants=frozenset(["V1","V2","V3","V4","V5","V7","V8"])),
        "TUNED":     dict(era_fair=True,  variants=frozenset(["V1","V2","V4","V5","V7","V8"])),
        "asb_V1":    dict(era_fair=False, variants=frozenset(["V1"])),
        "asb_V2":    dict(era_fair=False, variants=frozenset(["V2"])),
    }
    results = {}
    outs = {}
    for name, cfg in runs.items():
        df, A = build_scores(d, grid, era_fair=cfg["era_fair"], variants=cfg["variants"])
        out = composite(df, A, variants=cfg["variants"])
        v = verdict_series(out)
        outs[name] = (out, v, df)
        st, bh, avex, eq, _ = perf(v, tr, cash_daily, "2006-01-01", grid[-1])
        results[name] = dict(**{k: round(x, 3) for k, x in st.items()}, avg_expo=round(avex, 2))
        if name == "as_built":
            results["buy_hold"] = {k: round(x, 3) for k, x in bh.items()}
    res = pd.DataFrame(results).T
    print("=== Метрики стратегии 2006–2026 (экспозиция BUY 1.0 / HOLD+ .85 / HOLD .65 / REDUCE .35 / PROTECT 0; кэш = 3м T-bill) ===")
    print(res.to_string())

    # --- гейт: с ним и без ---
    out, _, _ = (outs["era_fair"][0], None, None)
    for g in (True, False):
        v = verdict_series(out, gate=g)
        st, _, avex, _, _ = perf(v, tr, cash_daily, "2006-01-01", grid[-1])
        print(f"гейт={'вкл' if g else 'выкл'}: {st} expo={avex:.2f}")

    # --- IC: корреляция композита с форвардной доходностью ---
    print("\n=== Прогнозная сила композита (Spearman IC, недельные точки) ===")
    for name in ("as_built", "era_fair", "TUNED"):
        o = outs[name][0]
        row = []
        for h, lab in ((20, "1м"), (60, "3м"), (120, "6м")):
            b = fwd_returns(o["composite"], spx, h)
            b = b.iloc[::5]
            ic = b["c"].corr(b["f"], method="spearman")
            row.append(f"{lab}: {ic:+.3f}")
        print(f"{name:>10}: " + " · ".join(row))

    # --- средняя форвардная доходность по вердиктам ---
    print("\n=== Форвардная доходность SPX (60 торг. дней, аннуализир.) по вердиктам ===")
    for name in ("as_built", "era_fair", "TUNED"):
        o, v, _ = outs[name]
        fwd = (spx.shift(-60) / spx - 1).reindex(v.index)
        tab = fwd.groupby(v).agg(["mean", "count"])
        tab["ann"] = (1 + tab["mean"]) ** (252 / 60) - 1
        print(name, {i: (f"{tab.loc[i,'ann']:+.1%}", int(tab.loc[i, 'count'])) for i in tab.index if i != "NA"})

    # --- эпизоды ---
    print("\n=== Эпизоды: минимальный композит и вердикт в окне; дата первого REDUCE/PROTECT ===")
    episodes = [
        ("GFC",        "2007-06-01", "2009-06-30", "2007-10-09"),
        ("Flash 2010", "2010-04-01", "2010-09-30", "2010-04-23"),
        ("US downgrade","2011-05-01","2011-12-31", "2011-04-29"),
        ("Китай 2015", "2015-06-01", "2016-04-30", "2015-05-21"),
        ("Q4 2018",    "2018-09-01", "2019-03-31", "2018-09-20"),
        ("COVID",      "2020-01-01", "2020-08-31", "2020-02-19"),
        ("Медведь 2022","2022-01-01","2022-12-31", "2022-01-03"),
        ("SVB 2023",   "2023-02-01", "2023-05-31", "2023-02-02"),
        ("Иена 2024",  "2024-07-01", "2024-09-30", "2024-07-16"),
        ("Тарифы 2025","2025-02-01", "2025-06-30", "2025-02-19"),
    ]
    for name in ("era_fair", "TUNED"):
        o, v, _ = outs[name]
        print(f"--- {name} ---")
        for ep, a, b, peak in episodes:
            try:
                w = o.loc[a:b, "composite"]
                vv = v.loc[a:b]
                first_red = vv[(vv == "REDUCE") | (vv == "PROTECT")]
                fr = str(first_red.index[0].date()) if len(first_red) else "—"
                pk = pd.Timestamp(peak)
                spx_pk = spx.asof(pk)
                trough = spx.loc[a:b].min()
                dd_at_signal = (spx.asof(first_red.index[0]) / spx_pk - 1) * 100 if len(first_red) else np.nan
                print(f"{ep:>12}: minКомпозит {w.min():+.0f} · перв.сокращение {fr} (SPX к пику {dd_at_signal:+.1f}%) · дно эпизода {(trough/spx_pk-1)*100:+.1f}%")
            except Exception as e:
                print(f"{ep:>12}: ошибка {e}")

    # --- распределение композита по годам ---
    print("\n=== Медианный композит по годам (era_fair) ===")
    o = outs["era_fair"][0]
    med = o["composite"].groupby(o.index.year).median()
    print(" ".join(f"{y}:{m:+.0f}" for y, m in med.items()))

    # --- доля времени в каждом вердикте ---
    print("\n=== Доля времени по вердиктам ===")
    for name in ("as_built", "era_fair", "TUNED"):
        _, v, _ = outs[name]
        print(name, (v.value_counts(normalize=True) * 100).round(1).to_dict())

    # сохранить серии для дальнейшего анализа
    outs["era_fair"][0].assign(verdict=outs["era_fair"][1]).to_csv(
        os.path.join(os.path.dirname(__file__), "series_era_fair.csv"))
    outs["ALL"][0].assign(verdict=outs["ALL"][1]).to_csv(
        os.path.join(os.path.dirname(__file__), "series_ALL.csv"))
    print("\nсерии сохранены")

if __name__ == "__main__":
    main()
