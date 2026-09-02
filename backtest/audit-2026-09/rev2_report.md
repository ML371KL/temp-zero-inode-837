# rev2 — adversarial review of finding P1 (VIX level → 21-day change)

## VERDICT: WEAKENED

The numbers reproduce exactly and there is no look-ahead or coding artifact. But the claim as framed ("a change rule beats a level rule") is not what the data support. The correct counterfactual is *removing the VIX card altogether*, and against that P1 adds nothing on the 2003–2026 panel (dSh +0.012, P=0.28; **negative** on 2015–2026, dSh −0.025, P=0.89) and only a marginal, insignificant +0.035 (P=0.12) on the 1990 core panel. What is real is the weaker statement "the VIX **level** card hurts the ladder". The gain is also concentrated (top-20 days = 82 % of cumulative excess; 2010+2011 = 66 %), was selected from ~155 ladder-level variant rows across a3/a5/a7/a8, and is of the same size as an economically empty perturbation (delaying the level card by one trading day moves baseline Sharpe +0.040).

---

## 1. Independent reproduction (own code path, `rev2_p1.py`; a8_final not imported)

Signal rebuilt from `loader`/`engine` with `variants=L.CURRENT`, own hardMarket/kill-switch, `harness.ladder_machine` + `simulate(cost 10 bp)`.

| 2003-01-02..2026-09-01 | Sharpe full | 2003–14 | 2015–26 | MaxDD | CAGR | mean E |
|---|---|---|---|---|---|---|
| BASE (live) | **0.762** | 0.767 | 0.763 | −18.2 | 9.28 | 0.707 |
| P1 (grid shift21, as in finding) | **0.813** | 0.852 | 0.784 | −16.8 | 9.78 | 0.700 |
| P1raw (change on raw VIX obs, no lead NaN) | 0.824 | 0.867 | 0.793 | −16.5 | 9.89 | 0.699 |
| **DROP vix card** | **0.800** | 0.795 | **0.809** | −16.9 | 9.82 | 0.717 |

1990 core panel (same extended HY/DXY recipe rebuilt in my script): BASE 0.629 / P1 0.673 / DROP 0.639; sub-windows P1 0.518/0.843/0.687 vs BASE 0.449/0.804/0.661 — identical to a8_cur.txt.

Reproduction is exact to 3 decimals in every cell. Cost sensitivity (0/10/25/50 bp): ordering P1 > DROP > BASE unchanged on both panels (`rev2_cost.py`).

## 2. Look-ahead / coding artifacts — none found, but one asymmetry

- **Timing**: `A["vix"]` at grid date t = VIX close of t−1 (avail = obs+1 calendar day, ffilled onto SPX grid); `simulate` shifts exposure by one more day. Verified on 2008-10-10: value used is 63.92 (= close of 2008-10-09). No look-ahead.
- **Leading NaN**: `vix_mom` computes `shift(21)` on the grid-reindexed series → first 21 grid days (2003-01-02..2003-01-31) have NaN card in P1 but a value in BASE; coverage<0.6 days 11→21. This works **against** P1 (P1raw, computed on raw observations, is higher: 0.824 vs 0.813). Not a mechanical boost.
- **Family averaging**: VIX is its own family in the market block; NaN drops it from the block mean. Only those 21 days are affected.
- Robustness variants (2003 panel Sharpe; bootstrap P vs BASE, block 63):
  - 22-calendar-day-ago value: 0.840 (P=0.000); 30-calendar-day: 0.825
  - log-change zones +40/+20/−20 %: 0.826 (P=0.002); +50/+25/−25 %: 0.825
  - VIX availability lag 2 calendar days (both cards lagged): P1 0.833 vs BASE 0.794, dSh +0.040 (P=0.008)
  - extra one *trading-day* shift on both cards: P1 0.820 vs BASE 0.802, dSh +0.018 (P=0.19) — significance disappears
  - same-day close (lag 0, info only): 0.807 — no sign of a timing edge being harvested
  - core panel: cal22 0.673, log 0.656, lag2 0.682 vs BASE-lag2 0.621, extra-shift 0.685 vs 0.631
- **Ladder fragility**: delaying the *baseline level card* by one trading day (no economic content) raises BASE from 0.762 to 0.802 (+0.040) on 2003–2026. The P1 effect (+0.050) is of the same order as this noise band. On the core panel the same perturbation is only +0.002, so this is panel-specific, but it caps how much a +0.05 on one card can mean.

## 3. Year-by-year attribution — not a 2008/2020 story, but a few-episodes story

2003 panel, cumulative return diff P1−BASE (pp): 2010 +3.37, 2011 +3.55, 2015 +1.56, 2022 +1.36, 2004 +1.15, 2012 +1.13, 2008 +0.88, 2020 +0.51; losers 2017 −1.18, 2003 −0.62, 2025 −0.51, 2014 −0.38, 2023 −0.37. Total +10.5 pp; P1 wins 11 of 18 non-tied years (6 ties with zero rung differences).
- Excluding 2008-09..2009-06 and 2020-02..2020-06: Sharpe BASE 0.817 → P1 0.862 (+0.045). The effect survives ex-crisis, so it is **not** GFC/COVID.
- But: only 599 of 5954 days have any return difference; the **top 20 days carry +8.6 of the +10.5 pp (82 %)**; ex-top-10 the cumulative diff is +5.4 pp. 2010+2011 alone = +6.9 pp (66 %). Mechanism: after the May-2010 and Aug-2011 vol spikes the change card flips to +1 while VIX is still 25–35 (level card −1), so P1 re-enters 1–3 weeks earlier.
- Core panel (1990–2026): winners 1998 +6.6, 2002 +4.6, 2011 +4.4, 2015 +3.5, 2003 +3.3, 2022 +2.3, 2020 +2.0; losers 2023 −2.2, 2014 −2.1, 2012 −1.7, 1991 −1.5, 2019 −1.5, 2024 −1.4. **P1 wins only 13 of 31 non-tied years**; top-10 days carry 70 % of the +13.0 pp.

## 4. Exposure confound — not the explanation

Mean exposure is slightly *lower* under P1 (0.700 vs 0.707; core 0.657 vs 0.669). Constant-exposure benchmark with the matched mean has Sharpe 0.593 for all three (Sharpe is scale-invariant), so edge-over-matched-benchmark = BASE +0.169, P1 +0.220, DROP +0.207 (2003 panel); core: +0.112 / +0.157 / +0.122. P1's edge exceeds baseline's, but DROP captures most of it. Long-P1/short-BASE: +45 bp/yr, HAC t=1.93 (2003), +36 bp/yr, t=1.22 (core). **Long-P1/short-DROP: −6 bp/yr, t=−0.30 (2003); +19 bp/yr, t=0.64 (core).**

## 5. Card scores on the requested dates (2003 panel; value at t = close of t−1)

| date | VIX(t−1) | 21d ago | Δ | card BASE | card P1 | comp B→P1 | rung B/P1 |
|---|---|---|---|---|---|---|---|
| 2008-10-10 | 63.92 | 24.52 | +39.4 | −2 | −2 | −79.4 → −79.4 | 0/0 |
| 2008-12-31 | 41.63 | 55.84 | −14.2 | −2 | **+1** | −27.5 → −17.5 | 1/1 |
| 2009-04-01 | 44.14 | 52.65 | −8.5 | −2 | **+1** | −56.9 → −46.9 | 0/0 |
| 2020-03-16 | 57.83 | 13.74 | +44.1 | −2 | −2 | −49.5 → −49.5 | 0/0 |
| 2020-04-30 | 31.23 | 57.08 | −25.9 | −1 | **+1** | −15.5 → −8.8 | 1/1 |
| 2022-06-15 | 32.69 | 28.87 | +3.8 | −1 | 0 | −30.9 → −27.6 | 1/1 |
| 2024-08-05 | 23.39 | 12.26 | +11.1 | 0 | **−2** | +15.0 → +8.3 | 3/3 |
| 2025-04-08 | 46.98 | 23.37 | +23.6 | −2 | −2 | −14.3 → −14.3 | 2/2 |
| 2025-05-15 | 18.62 | 30.89 | −12.3 | +1 | +1 | +43.5 → +43.5 | 3/3 |
| 2026-09-01 (last) | 14.92 | 15.99 | −1.1 | +1 | 0 | +25.5 → +22.1 | 3/3 |

Note 2008-12-31 and 2009-04-01: P1 scores VIX at 42–44 as **+1** (bullish) purely because it is off its peak. The card carries no level information at all; it behaves as a post-spike re-entry trigger.

Rung paths (Fridays, BASE/P1):
- 2020-02-14..07-03: `02-14:3/2 02-21:2/2 … 04-03:0/0 04-17:0/1 04-24:0/1 05-01:1/1 … 06-19:2/2` — P1 climbs 0→1 two weeks earlier (Apr 15 vs May 1); 10/97 days differ; cum ret −3.2 % vs −2.2 % (BH −6.5 %).
- 2022: 29/251 days differ: P1 stays at rung 1 instead of 0 for 05-20..05-27, rung 2 vs 1 on 07-22 and 09-02, rung 3 vs 2 on 12-02..12-09 (the last one is a loss). Cum ret −16.8 % vs −15.5 % (BH −18.1 %).
- 2008-09..2009-06: 1/209 days differ — the GFC path is unchanged, consistent with the finding.

## 6. Other reasons for distrust

1. **Wrong null.** a5 (H9) and a7 already showed "drop VIX level" = 0.800 / 0.795 / 0.809. The finding compares P1 to BASE, not to DROP. My paired bootstrap P1 vs DROP: full dSh +0.012, P(≤0)=0.28 (bl 21/63/126: 0.27/0.28/0.28); 2003–14 +0.057 (P=0.03); **2015–26 −0.025 (P=0.89)**. Core: +0.035 (P=0.12); 2015–26 −0.026 (P=0.66). P1raw vs DROP: +0.024 (P=0.12). The only statistically supported statement is DROP vs BASE on 2003–2026: +0.038 (P=0.04), +0.046 in 2015–26 (P=0.02) — and even that is insignificant on the core panel (+0.010, P=0.37).
2. **The change card is largely a past-return card.** corr(P1 card, past-21d SPX return) = +0.60 (level card: +0.31). Replacing the VIX card by a copy of `spx_mom` gives 0.791 (2003) / 0.672 (core); by SPX-21d-return zones 0.782 / 0.679; by "SPX up >4 % in a month → +1 else 0" 0.824 / 0.685. On the core panel these momentum proxies are indistinguishable from P1 (0.673). P1 partly double-weights short-term momentum already in the market block.
3. **The card itself has no forward information.** Spearman IC with forward 21-day SPX log-return: level card −0.091 (anti-predictive as a "bullish" score: high VIX → high forward return), P1 card −0.013 (≈ zero), spx_mom card −0.039. P1 "helps" by neutralising an anti-predictive card, not by adding a predictive one — which is exactly why it ≈ DROP.
4. **Selection.** Before P1 was declared, ~155 ladder-level variant rows were evaluated (a3: 28, a5: 55, a7: 32, a8: 40 lines with a Sharpe), including 4 VIX handlings in a7 and 15 window/threshold jitters in a8. The bootstrap P=0.004 is unadjusted for this search; my circular block bootstrap gives 0.011–0.012 (2003) and 0.048–0.070 (core, i.e. not <0.05 for bl 21). Any reasonable multiplicity haircut removes significance on the core panel and leaves 2003–2014 as the only window with a clear effect.
5. **Score distribution shift.** P1 card mean −0.02 vs +0.32 for the level card; P1 sits at 0 on 78 % of days and gives 0 on 2 577 of the 2 959 days where the level card says +1. Rung-4 share falls 8.1 → 6.4 %. So part of the change is simply "less bullish in calm markets" — the DD improvement (−18.2 → −16.8) is fully matched by DROP (−16.9).
6. Branch decomposition (2003 / core): stress branches only ("no +1") 0.818 / 0.672; re-entry branch only ("+1 if Δ<−5 else 0") 0.837 / 0.667; both 0.813 / 0.673. Neither branch is individually necessary; a single +1 re-entry flag does as well or better than the full 4-zone rule on 2003–2026.

## What survives

- No look-ahead, no NaN/coverage artifact, robust to calendar/log/lag re-specification, not an exposure or GFC/COVID artifact.
- Defensible statement: *the VIX level card (zones <13/13–20/20–26/26–35/>35) reduces ladder Sharpe by ≈0.04 on 2003–2026 (P≈0.04) and removing it, or replacing it by any near-neutral card, recovers that.* The specific 21-day-change rule adds nothing incremental on the full 2003–2026 panel, hurts in 2015–2026, and is only marginally positive (P=0.12) on 1990–2026.

## Reproduction

```
cd C:/Users/rodio/Desktop/Claude/razlom-audit
PYTHONIOENCODING=utf-8 python rev2_p1.py 2003-01-01    # -> out/rev2_p1_2003.txt, out/rev2_series_2003.csv (~3 min)
PYTHONIOENCODING=utf-8 python rev2_p1.py 1990-01-01    # -> out/rev2_p1_1990.txt, out/rev2_series_1990.csv (core panel, ~4 min)
PYTHONIOENCODING=utf-8 python rev2_cost.py             # cost sensitivity 0/10/25/50 bp from the saved series
```
Files: `rev2_p1.py` (all sections 1–6), `rev2_cost.py`, outputs `out/rev2_p1_2003.txt`, `out/rev2_p1_1990.txt`, `out/rev2_series_{2003,1990}.csv` (exposure, returns, rungs, both cards, both composites per day).
