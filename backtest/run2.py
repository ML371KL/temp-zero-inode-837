"""Раунд 2: восстановление после дна, чувствительность порогов, длительность PROTECT."""
import pandas as pd
import numpy as np
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from engine import load_all, build_scores, composite, verdict_series

EXPO = {"BUY": 1.0, "HOLD+": 0.85, "HOLD": 0.65, "REDUCE": 0.35, "PROTECT": 0.0, "NA": 0.65}

def perf(expo, tr, cash_daily, start, end):
    idx = tr.loc[start:end].index
    e = expo.reindex(idx).ffill().shift(1).fillna(0.65)
    r_mkt = tr.pct_change().reindex(idx).fillna(0)
    r_cash = cash_daily.reindex(idx).ffill().fillna(0)
    r = e * r_mkt + (1 - e) * r_cash
    eq = (1 + r).cumprod()
    yrs = (idx[-1] - idx[0]).days / 365.25
    cagr = eq.iloc[-1] ** (1 / yrs) - 1
    ret = eq.pct_change().dropna()
    vol = ret.std() * np.sqrt(252)
    sharpe = (ret.mean() * 252 - r_cash.mean() * 252) / vol
    dd = (eq / eq.cummax() - 1).min()
    return dict(cagr=round(cagr, 3), vol=round(vol, 3), sharpe=round(sharpe, 3), maxdd=round(dd, 3), expo=round(e.mean(), 2))

def main():
    d = load_all()
    spx = d["SPX"].s
    tr = d["SP500TR"].s
    grid = spx.loc["2004-01-01":].index
    cash_daily = (d["DTB3"].s / 100 / 252).reindex(grid, method="ffill")

    df, A = build_scores(d, grid, era_fair=True, variants=frozenset(["V1","V2","V4","V5","V8"]))
    out = composite(df, A, variants=frozenset())
    df7, A7 = build_scores(d, grid, era_fair=True, variants=frozenset(["V1","V2","V4","V5","V7","V8"]))
    out7 = composite(df7, A7, variants=frozenset(["V7"]))

    v_base = verdict_series(out)
    v_v7 = verdict_series(out7)

    print("=== база (без V7) vs V7 ===")
    print("base:", perf(v_base.map(EXPO), tr, cash_daily, "2006-01-01", grid[-1]))
    print("V7:  ", perf(v_v7.map(EXPO), tr, cash_daily, "2006-01-01", grid[-1]))

    # --- восстановительное правило: композит вырос на +15 за 20 торг. дней из зоны <-10 → вердикт на ступень выше
    print("\n=== правило восстановления (импульс композита) ===")
    for thresh in (10, 15, 20):
        comp = out["composite"]
        mom = comp - comp.shift(20)
        v = v_base.copy()
        up = (mom > thresh) & ((v == "PROTECT") | (v == "REDUCE"))
        v[up & (v == "PROTECT")] = "REDUCE"
        v[up & (v == "REDUCE")] = "HOLD"
        print(f"Δ20>{thresh}:", perf(v.map(EXPO), tr, cash_daily, "2006-01-01", grid[-1]))

    # комбинация V7 + правило восстановления
    comp = out7["composite"]
    mom = comp - comp.shift(20)
    v = v_v7.copy()
    up = (mom > 15) & ((v == "PROTECT") | (v == "REDUCE"))
    v[up & (v == "PROTECT")] = "REDUCE"
    v[up & (v == "REDUCE")] = "HOLD"
    print("V7+Δ20>15:", perf(v.map(EXPO), tr, cash_daily, "2006-01-01", grid[-1]))

    # --- чувствительность порогов вердиктов ---
    print("\n=== чувствительность порогов (база, гейт вкл) ===")
    for buy, hold, red in ((30, 10, -10), (25, 5, -15), (35, 15, -5), (30, 10, -20)):
        s = out["composite"]; lead = out["lead"]
        v = pd.Series("HOLD", index=out.index, dtype=object)
        v[s >= buy] = "BUY"
        v[(s >= hold) & (s < buy)] = "HOLD+"
        v[(s <= red) & (s > -30)] = "REDUCE"
        v[s <= -30] = "PROTECT"
        v[(v == "BUY") & (lead < 10)] = "HOLD+"
        v[(v == "PROTECT") & (lead > -10)] = "REDUCE"
        v[out["cover"] < 0.6] = "NA"
        print(f"buy={buy} hold={hold} red={red}:", perf(v.map(EXPO), tr, cash_daily, "2006-01-01", grid[-1]))

    # --- длительность и последствия PROTECT ---
    print("\n=== эпизоды PROTECT (база) ===")
    vp = (v_base == "PROTECT").astype(int)
    starts = vp[(vp == 1) & (vp.shift(1) == 0)].index
    ends = vp[(vp == 0) & (vp.shift(1) == 1)].index
    for s0 in starts:
        e0 = ends[ends > s0]
        e0 = e0[0] if len(e0) else vp.index[-1]
        dur = (e0 - s0).days
        in_ep = (spx.asof(e0) / spx.asof(s0) - 1) * 100
        after = (spx.asof(e0 + pd.Timedelta(days=90)) / spx.asof(e0) - 1) * 100
        print(f"{s0.date()} → {e0.date()} ({dur} дн): SPX в эпизоде {in_ep:+.1f}%, 3 мес после {after:+.1f}%")

    # --- вклад V7: когда срабатывала триада разворота ---
    dif = (out7["detpts"] - out["detpts"])
    tr_days = dif[dif >= 10]
    if len(tr_days):
        # сгруппировать в эпизоды
        gaps = tr_days.index.to_series().diff() > pd.Timedelta(days=15)
        ep_id = gaps.cumsum()
        for i, g in tr_days.groupby(ep_id):
            a, b = g.index[0], g.index[-1]
            fwd = (spx.asof(b + pd.Timedelta(days=90)) / spx.asof(a) - 1) * 100
            print(f"триада разворота: {a.date()} → {b.date()} ({len(g)} дн), SPX 3 мес после начала: {fwd:+.1f}%")

if __name__ == "__main__":
    main()
