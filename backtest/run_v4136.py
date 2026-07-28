# -*- coding: utf-8 -*-
"""Бэктест правок v4.13.6: VT (нейтраль термструктуры) + OH (гистерезис нефти).

Правки — про СТАБИЛЬНОСТЬ сигнала, поэтому меряем два класса метрик:
  · риск/доходность (не должны ухудшиться);
  · дребезг: смены вердикта, смены состояния нефтяного детектора, суточные скачки композита.
"""
import pandas as pd, numpy as np, sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.dirname(__file__))
import warnings; warnings.filterwarnings('ignore')
from engine import load_all, build_scores, composite, verdict_series

EXPO = {"BUY": 1.0, "HOLD+": 0.85, "HOLD": 0.65, "REDUCE": 0.35, "PROTECT": 0.0, "NA": 0.65}

def perf(verdicts, tr, cash_daily, start, end):
    idx = tr.loc[start:end].index
    expo = verdicts.map(EXPO).reindex(idx).ffill().shift(1).fillna(EXPO["HOLD"])
    r_mkt = tr.pct_change().reindex(idx).fillna(0)
    r_cash = cash_daily.reindex(idx).ffill().fillna(0)
    r = expo * r_mkt + (1 - expo) * r_cash
    eq = (1 + r).cumprod()
    yrs = (idx[-1] - idx[0]).days / 365.25
    cagr = eq.iloc[-1] ** (1 / yrs) - 1
    ret = eq.pct_change().dropna()
    vol = ret.std() * np.sqrt(252)
    sharpe = (ret.mean() * 252 - r_cash.mean() * 252) / vol if vol > 0 else 0
    dd = (eq / eq.cummax() - 1).min()
    return dict(cagr=cagr, vol=vol, sharpe=sharpe, maxdd=dd, expo=expo.mean())

def stability(out, verd):
    """дребезг: смены вердикта в год, суточные скачки композита, качки (A→B→A за 2 шага)."""
    v = verd[verd != "NA"]
    ch = (v != v.shift(1)).sum() - 1
    yrs = (v.index[-1] - v.index[0]).days / 365.25
    c = out["composite"].dropna()
    d = c.diff().abs()
    # «качок»: значение вернулось на прежний уровень через 2 шага, а промежуточное отличалось на ≥4
    mid = c.shift(1); prev = c.shift(2)
    flap = ((c - prev).abs() < 0.6) & ((mid - c).abs() >= 4)
    return dict(verd_ch_yr=ch / yrs, comp_jump_p99=d.quantile(0.99), comp_jump_max=d.max(),
                comp_std_d=d.mean(), flaps=int(flap.sum()), flaps_yr=flap.sum() / yrs)

def oil_flips(out_pts_states):
    s = out_pts_states.dropna()
    return int((s != s.shift(1)).sum() - 1)

def main():
    d = load_all()
    spx = d["SPX"].s
    tr = d["SP500TR"].s
    grid = spx.loc["2004-01-01":].index
    cash = d["DTB3"].s / 100 / 252
    cash_daily = cash.reindex(grid, method="ffill")
    START, END = "2006-01-01", "2026-07-01"

    BASE = frozenset(["V1", "V2", "V4", "V5", "V7", "V8"])       # TUNED = боевая конфигурация
    runs = {
        "era_fair (как в проде)": frozenset(),
        "  + VT нейтраль-терм":   frozenset(["VT"]),
        "  + OH гистерез-нефть":  frozenset(["OH"]),
        "  + VT + OH":            frozenset(["VT", "OH"]),
        "TUNED":                  BASE,
        "TUNED + VT":             BASE | {"VT"},
        "TUNED + OH":             BASE | {"OH"},
        "TUNED + VT + OH":        BASE | {"VT", "OH"},
    }
    rows = {}
    stab = {}
    for name, vs in runs.items():
        df, A = build_scores(d, grid, era_fair=True, variants=vs)
        out = composite(df, A, variants=vs)
        verd = verdict_series(out)
        rows[name] = perf(verd, tr, cash_daily, START, END)
        stab[name] = stability(out.loc[START:END], verd.loc[START:END])

    R = pd.DataFrame(rows).T
    S = pd.DataFrame(stab).T
    print("=== РИСК/ДОХОДНОСТЬ 2006–2026 ===")
    print(R.round(4).to_string())
    print()
    print("=== СТАБИЛЬНОСТЬ СИГНАЛА (ради чего правки) ===")
    print(S.round(3).to_string())
    print()
    base = R.loc["era_fair (как в проде)"]
    for n in ["  + VT нейтраль-терм", "  + OH гистерез-нефть", "  + VT + OH"]:
        r = R.loc[n]
        print("%-24s ΔSharpe %+0.4f · ΔCAGR %+0.3f п.п. · ΔmaxDD %+0.3f п.п. · Δкачков/год %+0.2f · Δсмен вердикта/год %+0.2f" % (
            n.strip(), r.sharpe - base.sharpe, (r.cagr - base.cagr) * 100, (r.maxdd - base.maxdd) * 100,
            S.loc[n].flaps_yr - S.loc["era_fair (как в проде)"].flaps_yr,
            S.loc[n].verd_ch_yr - S.loc["era_fair (как в проде)"].verd_ch_yr))
    print()
    bt = R.loc["TUNED"]
    for n in ["TUNED + VT", "TUNED + OH", "TUNED + VT + OH"]:
        r = R.loc[n]
        print("%-24s ΔSharpe %+0.4f · ΔCAGR %+0.3f п.п. · ΔmaxDD %+0.3f п.п. · Δкачков/год %+0.2f · Δсмен вердикта/год %+0.2f" % (
            n, r.sharpe - bt.sharpe, (r.cagr - bt.cagr) * 100, (r.maxdd - bt.maxdd) * 100,
            S.loc[n].flaps_yr - S.loc["TUNED"].flaps_yr, S.loc[n].verd_ch_yr - S.loc["TUNED"].verd_ch_yr))

    # ── окно OOS: только 2020–2026 (вне окна калибровки v4.8) ──
    print()
    print("=== ОКНО 2020–2026 (после калибровки) ===")
    for name in ["era_fair (как в проде)", "  + VT + OH", "TUNED", "TUNED + VT + OH"]:
        vs = runs[name]
        df, A = build_scores(d, grid, era_fair=True, variants=vs)
        out = composite(df, A, variants=vs); verd = verdict_series(out)
        p = perf(verd, tr, cash_daily, "2020-01-01", END)
        st = stability(out.loc["2020-01-01":END], verd.loc["2020-01-01":END])
        print("%-24s Sharpe %.3f · CAGR %.3f · maxDD %.3f · качков/год %.2f · смен вердикта/год %.2f" % (
            name.strip(), p["sharpe"], p["cagr"], p["maxdd"], st["flaps_yr"], st["verd_ch_yr"]))

main()
