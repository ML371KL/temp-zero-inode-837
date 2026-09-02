# REV1 — adversarial review of the Razlom-26 backtest audit (live logic v4.13.9, `_cur` runs)

Scope: try to break claims C1–C5. All numbers below are recomputed by me from `engine.py`/`harness.py` on the same data
(2003-01-02..2026-09-01, 5954 trading days). Scripts: `rev1_main.py` (sections A–F) and `rev1_extra.py` (sections i–vii).
Outputs: `out/rev1_main.txt`, `out/rev1_extra.txt`, `out/rev1_ic.csv`, `out/rev1_ablation.csv`. No existing file was modified.

Reproduce everything:
```
cd C:/Users/rodio/Desktop/Claude/razlom-audit
PYTHONIOENCODING=utf-8 python rev1_main.py  > out/rev1_main.txt
PYTHONIOENCODING=utf-8 python rev1_extra.py > out/rev1_extra.txt
```
(both run in < 1 min; the engine builds in 0.2 s).

## Summary table

| Claim | Verdict | One-line reason |
|---|---|---|
| C1 negative composite IC, level indicators contrarian, detectors positive | **HOLDS** (sign, even stronger ex-crisis); significance at 12m overstated; detector part **weakened** | non-overlapping/Kendall/raw-level all agree; 12m CIs with block ≥ horizon barely exclude 0; detpts IC shrinks to ~0 ex-2022 |
| C2 PROTECT ≈ −12%/yr, REDUCE ≈ +25%, non-monotone | **WEAKENED** | non-monotonicity is robust; PROTECT's negative forward return is one episode (2007-Q4→2008); ex-recession PROTECT is a *buy* signal (+18%/yr at 3m) |
| C3 rung-0 entries mostly followed by gains; deep-dd exposure 0.15 with +20–30% fwd | **HOLDS numerically**, count corrected 15→12; sample is 3 crash clusters | 10/10 entries with dd>10% gained at 6m/12m; deep-dd days = exactly 3 clusters; rung-0 net opportunity cost ≈ 0 only because of 2008 |
| C4 Sharpe 0.76/−18.2/9.3% vs 0.59/−55/11.6%; ex-crisis = B&H | **HOLDS** (replicates exactly) with a sharper gloss | DASH−B&H Sharpe not significant (P=0.12); timing return vs constant exposure is −31 pp cumulative ex-2008; DASH beats B&H in 41% of rolling 3y windows |
| C5 leave-one-out: most removals help; only JPY & S&P-mom valuable; plumbing block valuable | **PARTLY REFUTED** | ranking is not an exposure artifact (rank-corr with Jensen alpha 0.97) but is inside placebo noise; "JPY valuable" is an artifact of a constant −2 score on 94% of days; spx_mom and plumbing effects not significant |

No look-ahead was found in the forward-return construction, the simulator, the lag mechanics, or the a5/a7 transformations. No unit or aggregation coding error was found in `engine.py`. Two *structural* artifacts materially shape composite values (JPY constant, HY zone map) — see §E.

---

## A. Look-ahead audit (task item a)

Method: empirical tests rather than code reading alone (`rev1_main.py` section A).

1. **Score timing.** Day-over-day changes of market-derived scores correlate with *yesterday's* return, not today's:
   Δspx_mom vs r(t) −0.020, vs r(t−1) **+0.351**, vs r(t−2) −0.027; Δvix −0.020 / +0.248 / −0.011; Δspx −0.018 / +0.225 / −0.028.
   Rebuilding `spx_mom` from raw closes with zero lag and shifting by k days: match with the engine is 82.9% (k=0), **100.0% (k=1)**, 82.9% (k=2). The engine's lag is exactly one trading day, never zero.
2. **Simulator.** `simulate()` applies `expo.shift(1)` to `tr.pct_change()`; corr(exposure_used(t), r(t)) = +0.0017. Feeding it a perfect-foresight exposure 1{r(t+1)>0} yields Sharpe 8.86 only because that exposure itself uses t+1; feeding 1{r(t)>0} yields −0.09, i.e. the shift is applied. Observation → decision → execution chain is obs close t → score on grid day t+1 → position at close t+1 → earns t+2 return: one full trading day between observation and execution.
3. **Publication lags.** Weekday on which each macro score changes: claims (lag 12) Thursday 224/231; NFCI (lag 5) Wednesday 30/30; net-liquidity (H.4.1, lag 2) Friday 475/493 — consistent with real release calendars. Payrolls/Sahm/SLOOS (lag 35) change mostly on Mondays (35 calendar days after the 1st of month lands near the actual first-Friday release +1 business day).
4. **Forward returns in a1.** `fwd = log(TR[t+h]/TR[t]) − Σcash(t+1..t+h)` is measured from the close of the day the score becomes available, with the score built from obs ≤ t−1. No leak.
5. **a5/a7 transformations.** `reentry_floor`, `dd_guard`, `trend_cap`, a7 `reentry`: all use `cond.shift(1)` (close t−1) before `simulate` shifts again → two-day gap. `cap_duration` run-length is a backward cumulative count. `hy_relative` uses backward rolling 252d stats on the PIT `A["hy"]`. `vix_variant` uses PIT `A["vix"]`. a7 new indicators are lagged with `lag(...,1)` / `lag(...,5)`. None uses future data.
6. **Execution-delay sensitivity.** exec_lag 1/2/3 → Sharpe 0.762 / 0.764 / 0.781. A leaky signal decays with delay; this one does not.

Minor notes (not leaks in the `_cur` runs): `era_fair` oil deflator uses `cpi.iloc[-1]` (last CPI, a look-ahead — but `era_fair=False` everywhere here). DTWEXBGS lag 4 calendar days is optimistic for Monday–Wednesday observations (H.10 is released the following Monday, i.e. 5–7 days); `dxy` has |IC| < 0.02, immaterial. Payrolls/Sahm lag 35 vs the first-Friday release (`rev1_extra.py` §viii): early by 1–2 days in 61/283 months, late by up to 7 days in 222, mean offset +1.55 days (conservative on average); the score changes on only 53 days and |IC| ≤ 0.08, so this cannot move any result. Cash return uses DTB3 of the same day (≈0.01%/day, immaterial).

---

## C1 — negative composite IC (task items b, c)

**VERDICT: HOLDS** in sign and magnitude; 12m significance overstated; "detectors positive" weakened.

Evidence (`out/rev1_ic.csv`, `rev1_main.txt` §B, `rev1_extra.txt` §i–ii):

- Non-overlapping samples (every h trading days, all phase offsets, mean over phases / share of phases negative / Kendall τ on one phase):
  - composite: 1m −0.091 (100% neg, n=283/phase), 3m −0.086 (92%), 6m −0.106 (77%), 12m **−0.285 (98%, n=23/phase)**; Kendall −0.061 / −0.114 / +0.003 / −0.225.
  - coin: 12m −0.305 (100% neg), Kendall −0.340. hy 12m −0.330, ig −0.303, sloos −0.296, sahm −0.227, vix −0.166 (all ≥ 84% of phases negative).
- Overlap does not create the sign, but it did inflate a1's significance. Block bootstrap with block = 2×horizon (100 weeks at 12m) instead of a1's 13 weeks: composite 12m CI [−0.53, −0.02] (a1: [−0.49, −0.10]); coin [−0.60, −0.06]; hy [−0.58, −0.16]; ig [−0.55, −0.09] still exclude 0, but **sloos [−0.58, +0.08], sahm [−0.48, +0.08], vix [−0.40, +0.08] no longer do**. Median Spearman p across non-overlapping annual samples: composite 0.18, coin 0.13, hy 0.11. The robustly significant part is the 1m horizon on monthly samples: coin p=0.045, credit block p=0.032, hy p=0.038 (n=283).
- Not a zone-coding artifact: the IC of the *raw* PIT levels is positive with 0% negative phases at every horizon — HY OAS 12m **+0.346**, VIX +0.243, Sahm +0.276. The score IC is the raw level's IC with the sign flipped by the zone map (high spread → low score). This is the textbook risk-premium/mean-reversion effect, not a bug.
- Not driven by 2008–09/2020: excluding those years the composite 12m IC is **−0.352** (98% neg); additionally excluding 2007-H2 and 2022 it is **−0.491** (100% neg); coin −0.348 / −0.448; hy −0.362 / −0.393. The negative IC is a property of normal times.
- "coincident aggregate −0.33 at 12m": weekly −0.325, non-overlapping −0.305, Kendall −0.340. Confirmed.
- Detector points: weekly IC +0.084/+0.162/+0.233/+0.164; non-overlapping +0.080/+0.181/+0.230/+0.154 with 0% negative phases at 1–6m, but median p 0.11/0.17/0.10/0.53 (not significant). Ex-2008-09/2020: +0.025/+0.094/+0.135/+0.043; also ex-2007-H2/2022: **+0.004/+0.032/+0.064/−0.033**. The positive detector IC is mostly the 2008-H1 and 2022 oil shocks (−10) and a handful of pivot (+10) days; it does not survive removal of those episodes.

Repro: `python rev1_main.py` §B; `python rev1_extra.py` §i, §ii.

## C2 — forward returns by verdict

**VERDICT: WEAKENED.** Non-monotonicity is robust; "PROTECT is the only informative verdict" rests on one episode.

Evidence (`rev1_main.txt` §C, `rev1_extra.txt` §iii):

- Full sample (3m excess, annualized): PROTECT −12.1% (n=431), REDUCE +25.4%, HOLD +9.8%, HOLD+ +9.5%, BUY +8.5% — replicates a1.
- PROTECT days: 431 total = **320 in 2008–09 + 44 in 2020 + 26 in 2022 + 41 other** (the "other" are mainly 2007-Nov/Dec).
- Excluding 2008–09 and 2020 (n=67 PROTECT days): 1m **+24.8%**, 3m **+4.8%**, 12m −6.9%. Excluding NBER recessions (n=86): 1m **+43.3%**, 3m **+18.0%**, 12m +1.0%. Excluding also 2022 (n=41, i.e. essentially 2007-Q4): 3m −2.7%, 12m −17.7% — those 41 days' 12m windows end inside 2008.
- Episode-weighted (11 contiguous PROTECT runs ≥ 5 days): mean-of-episode fwd3m **+21.4%/yr** (median +31.7), 4/11 negative — all four are 2007-11-08, 2007-11-20, 2007-12-28, 2008-04-30. Every PROTECT episode from 2009 on (2009-01-30, 2009-07-07, 2020-03-04, 2020-05-06, 2020-05-14, 2022-05-18, 2022-10-10) was followed by positive 3m and 12m returns.
- By *traded* rung (hysteresis ladder) ex-2008-09/2020: rung 0 n=47, 1m +19.5%, 3m +1.2%; ex also 2007-H2/2022: rung 0 has **9 days** left.
- Non-monotone gradation holds in every subsample: REDUCE 3m +21.9…+27.6% vs BUY +5.4…+8.1%, HOLD > HOLD+ > BUY. That part of C2 is solid.

Conclusion: PROTECT's −12%/yr is the GFC (2007-Q4 entries plus 2008 days). Outside it, PROTECT/rung-0 days precede gains. "Only PROTECT is informative" should read "PROTECT was informative once".

Repro: `python rev1_main.py` §C; `python rev1_extra.py` §iii.

## C3 — rung-0 entries and deep-drawdown exposure

**VERDICT: HOLDS numerically, with two corrections: count is 12 (not 15) and the deep-drawdown evidence is three episodes.**

Evidence (`rev1_main.txt` §D, `rev1_extra.txt` §v; cluster count in transcript):

- Entries into rung 0 on the live logic: **12** (2 via the kill-switch override: 2019-01-02, 2020-03-03). The figure "15" comes from the old-logic run `out/a6.txt` (without V1…OH): it adds 2003-01-27, 2010-05-21 and 2011-09-29, and dates the 2009 entries differently (2009-01-06/01-15/02-03/06-29 vs live 01-22/02-04/05-29/07-08). In that old run 5 of 15 entries show negative 3m returns (2007×2, 2009-01-06, 2010-05-21, 2011-08-26) — that is where "~4" came from. The claim mixed runs.
- Forward *excess* returns measured from the execution close (t+1): losses at 3m **3/12** (2007-11-09 −5.3%, 2007-12-31 −5.5%, 2011-08-26 −0.9%), at 6m and 12m **2/12** (both 2007). Mean excess after entry: +6.4% (3m), +12.0% (6m), +10.0% (12m).
- Entries with SPX already >10% below its 1y high: 10 of 12; **0/10 losses at 6m and 12m**, mean +16.0% / +21.3%. Confirmed.
- Days SPX >20% below 1y high: 330; average used exposure **0.16**; by year 2008 0.00, 2009 0.21, 2020 0.00, 2022 0.32, 2023 0.65. Forward 12m total return from those days +25.8% (2008 +13.2, 2009 +30.6, 2020 +62.6, 2022 +19.2, 2023 +24.7). But merging gaps ≤ 63 days, deep-drawdown days form **exactly 3 clusters**: 2008-07-09..2009-09-03, 2020-03-12..2020-04-07, 2022-06-13..2023-01-03. n=3 episodes, all in the post-2009 "buy-the-dip" regime.
- Net opportunity cost of rung 0 (cumulative market excess return over the 408 rung-0 days, next-day execution): **+1.8%** in total — 2008 −40.6% avoided; 2009 +18.8%, 2022 +12.4%, 2007/2011/2019 +3.5% each *missed*. Rung 0 is a wash over the sample and is only justified by 2008.

Repro: `python rev1_main.py` §D; cluster count and old-logic comparison: `python rev1_extra.py` §viii and `grep -A16 "INTO rung 0" out/a6.txt`.

## C4 — baseline ladder metrics

**VERDICT: HOLDS** (replicates to the third decimal). The gloss should be sharpened.

Evidence (`rev1_main.txt` §E, `rev1_extra.txt` §v–vi):

- DASH Sh 0.762 / maxDD −18.2% / CAGR 9.28% vs B&H 0.591 / −55.3% / 11.61%. Ex-GFC/COVID (a7 windows 2008-09..2009-06, 2020-02-19..06-30): **0.817 vs 0.831**. Confirmed. With the GFC window starting 2007-10-01: 0.853 vs **0.932**; additionally ex-2022: 0.995 vs 1.084 — ex-crisis the dashboard is *below* buy-and-hold.
- Paired block bootstrap (63d blocks) of Sharpe(DASH) − Sharpe(B&H): full sample **+0.172, P(≤0)=0.121, 95% CI [−0.10, +0.45]**; ex-GFC/COVID −0.015, P=0.64. The headline Sharpe edge is not statistically distinguishable from zero even with 2008 in the sample.
- Return contribution of timing (DASH minus constant exposure 0.707, daily differences summed): **−3.3 pp** over 24 years; **−31.4 pp ex-2008**; −15.3 pp ex-2008-09. Positive in 10/24 calendar years; 2008 +28.1 pp, 2009 −16.2 pp. By rung: rung 1 (35%) −11.8 pp, rung 2 −7.6 pp, rung 0 −1.7 pp, rung 3 +14.3 pp, rung 4 +3.5 pp.
- Rolling 3-year Sharpe: DASH > B&H in **41%** of windows (34% for windows ending 2011–2026). Sub-periods: 2003-01..2007-09 0.79 vs 0.87; 2007-10..2009-06 −0.54 vs −0.57 (DD −7.6 vs −55.3); 2009-07..2019-12 0.85 vs 0.98; 2020 1.10 vs 0.65; 2021..2026 0.76 vs 0.73.
- Cost sensitivity: 0/10/25/50 bp → Sharpe 0.782/0.762/0.732/0.682. Execution lag 1/2/3 → 0.762/0.764/0.781.

So C4's numbers stand, and the audit's own conclusion ("tail hedge, not a return machine") is if anything understated: all of the Sharpe/drawdown advantage is the 2008 and 2020 drawdown avoidance, while the timing return is negative everywhere else.

Repro: `python rev1_main.py` §E; `python rev1_extra.py` §v, §vi.

## C5 — leave-one-out ablation (task item d)

**VERDICT: PARTLY REFUTED.** Exposure-level artifact: no. Statistical content of the ranking: none. "USD/JPY valuable": an artifact.

Evidence (`out/rev1_ablation.csv`, `rev1_main.txt` §F, `rev1_extra.txt` §iv):

- (d) Exposure-level test. For each of 28 single-indicator removals I computed ΔSharpe, Δmean-exposure, ΔJensen-alpha (regression on market excess), ΔIR, and ΔIR of (strategy − constant-matched exposure), in full/H1/H2. Spearman rank correlation of ΔSharpe with ΔJensen-alpha across the 28: **0.972 / 0.961 / 0.987**; with Δexposure: −0.32 / −0.45 / −0.07. The "improves in both halves" list under alpha and under IR-vs-const is identical to the Sharpe list (dxy, netliq, stagf, oil, real10, nfci, goldreal, ratevol, spx, vix, tga, cny). (A constant-exposure benchmark has the same Sharpe at any exposure level — 0.591 — so "Sharpe vs const-matched" cannot move by construction; alpha/IR is the right adjustment.) **The ranking is not an exposure artifact.**
- But the ranking is inside noise. Placebo: replace ONE indicator by an iid shuffle of its own scores (28 indicators × 3 seeds = 84 runs): ΔSharpe mean **+0.020, sd 0.021, 5–95% [−0.009, +0.066], 82% > 0**. The observed leave-one-out ΔSharpe ranges from −0.021 to +0.054, i.e. entirely within the placebo band. Any perturbation of any one indicator helps by ≈ +0.02 — that is the composite's negative-IC property (C1), not information about *which* indicator hurts. Paired bootstrap p-values for the top removals (dxy 0.004, stagf 0.017, oil 0.023, netliq 0.028) look significant individually but 28 tests were run (Bonferroni 0.0018) and the relevant null is the placebo, not zero.
- "USD/JPY valuable in both halves" — **refuted**. `jpy` scores −2 on **94.0%** of days (USDJPY < 152 for all of 2003–2023; mean score pre-2024 −2.00, 2024+ −1.28). Replacing it by a constant −2 gives Sharpe 0.766 vs 0.762 and an identical exposure path on 96.3% of days. Its removal "hurts" (ΔSh −0.009, bootstrap P(≤0)=0.54, i.e. nothing) because it removes a constant offset: lead −7.95 pts, composite −2.23 pts on average. That constant halves the BUY gate: share of days with lead ≥ 10 is 22.6% with jpy vs 49.1% without; BUY verdict share 8.9% vs 17.9%; PROTECT-gate open 20.8% vs 13.2%. The gate flips 578 BUY→HOLD+ days and 48 PROTECT→REDUCE days in total. This is a calibration constant baked into a "lead" indicator, not a signal.
- "S&P momentum valuable in both halves": ΔSh −0.013 (full, bootstrap P(≤0)=0.60), −0.010 (H1), −0.016 (H2); ΔJensen-alpha in H1 is **+0.05 pp** (removal *improves* alpha in H1). Not robust. Under alpha the only indicator whose removal hurts in both halves is `ig`; under IR-vs-const, `ig` and `spx_mom`.
- "Removing the plumbing block hurts in both halves": ΔSh −0.033 full, **−0.007 H1**, −0.060 H2; bootstrap P(ΔSh ≤ 0) = 0.80 (i.e. only 80% confidence the block helps); removing it also lowers mean exposure by 0.047, and Δalpha is −0.27 pp full / −0.08 pp H1. The H1 effect is zero; the H2 effect is one-sided and not significant.

Repro: `python rev1_main.py` §F; `python rev1_extra.py` §iv.

---

## E. engine.py coding review (task item e)

Checked and **clean**:

- **Units.** WTREGEN (min 3745, all in $mn) → the `≤2500` fork never triggers, `/1000` always applies → $bn. WRESBAL post-2009 min > 100 000 ($mn) → `/1000` always applies → $bn; GDP in $bn → reserves/GDP in %. WALCL $mn→$bn; RRPONTSYD already $bn; net liquidity in $tn. Correct.
- **Coverage gate.** `cover` min 0.57, median 0.93; only 11 days (Jan 2003) below 0.6. Denominator adapts to dropped columns in ablations, so ablation never trips the gate.
- **Family averaging.** Hand recomputation of `comp_raw` on 2026-09-01 = 29.47 = engine (blocks plumb 15.3, credit 58.3, market 50.0, macro 0.0, regime 7.1). Per-indicator (no family) averaging correlates 0.987 with the engine composite, mean |diff| 3.1 pts — the family layer is not what drives the results.
- **OH oil-hysteresis loop.** Sequential, forward-only; versus the plain detector it is more negative on 104 days and less negative on none; composite correlation 0.9996. Immaterial (`rev1_extra.py` §viii).
- **Lag mechanics** (`avail_series`, `D.at`, `asof`): see §A — correct by empirical test.

Material **structural** findings (faithful replica, but they change what the composite means):

1. `jpy`: absolute thresholds 152/158 make the score −2 on 94% of days → permanent −8 pt lead offset, −2.2 pt composite offset, BUY gate closed on roughly half the days it would otherwise be open (§C5).
2. `hy` zone map has no neutral zone (`<300→+2, <350→+1, <450→−1, else −2`); HY is at −1/−2 on 74% of days (2652 + 1769 of 5954). The "worst zone" (−2, OAS > 450 bp) is 44% of the sample, so its high forward return is the unconditional risk premium, not a crisis signal.
3. `oil`: WTI > $80 → −1 (16% of days) plus shock −2 (16%); constant drag in 2005–08, 2011–14, 2022.
4. V7 "turn" detector adds +10 on **881 days (14.8%)** — a large, mostly post-stress bonus; as designed, but it dominates `detpts` alongside the oil detector (`rev1_extra.py` §viii).
5. `era_fair` oil deflator uses `cpi.iloc[-1]` (full-sample look-ahead) — unused in the `_cur` runs, but must not be used for a PIT era-fair comparison.
6. DTWEXBGS lag 4 days is 1–3 days optimistic for early-week observations (weekly H.10 release); `dxy` has negligible IC so the effect is nil.

None of these is a bug in the replica; 1–2 are design artifacts that explain much of C1/C5.

---

## Bottom line for the audit author

- C1 survives every attack (non-overlapping, Kendall, raw levels, ex-crisis) — state the 1m results as the significant ones and soften the 12m CIs; drop "detectors have positive IC" to "positive but not significant, mostly oil-shock/2022".
- C2: keep the non-monotonicity; rewrite PROTECT as "negative only through the GFC; positive (+18%/yr at 3m) outside recessions".
- C3: 12 entries, not 15 (the 15 is the old-logic run); "almost always gains" is true and is three crashes.
- C4: numbers exact; add that the Sharpe edge is not significant (P=0.12) and that timing return is −31 pp ex-2008.
- C5: the leave-one-out ranking is placebo-level noise; delete the JPY and S&P-momentum "valuable" statements (JPY is a constant), and qualify the plumbing-block statement (H1 effect −0.007, P=0.80).
