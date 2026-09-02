# -*- coding: utf-8 -*-
"""rev2: adversarial reproduction of finding P1 (VIX level -> 21d change). Own code path; does not import a8_final."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, metrics

START = sys.argv[1] if len(sys.argv) > 1 else "2003-01-01"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = open(os.path.join(HERE, "out", f"rev2_p1_{START[:4]}.txt"), "w", encoding="utf-8")
def P(*a):
    s = " ".join(str(x) for x in a); print(s); OUT.write(s + "\n"); OUT.flush()

d = L.load_all(); spx = d["SPX"].s; tr = d["SP500TR"].s; cash = d["DTB3"].s / 100 / 252
VIXRAW = d["VIXCLS"].s
grid = spx.loc[START:].index
trr = tr.pct_change().reindex(grid).fillna(0.0); cashr = cash.reindex(grid).ffill().fillna(0.0)
SPLITS = [(None, None), ("2003-01-01", "2014-12-31"), ("2015-01-01", None)]
CORE = ["spx","spx_mom","vix","hy","hy_mom","ig","sloos","nfci","ratevol","payrolls","sahm","claims","curve","jpy","oil","dxy","cny","goldreal"]
if START < "2003":
    baa = L.fred("BAA10Y"); hy_full = d["BAMLH0A0HYM2"].s
    common = baa.index.intersection(hy_full.index); bh = np.polyfit(baa.reindex(common), hy_full.reindex(common), 1)
    hy_ext = pd.concat([(bh[0]*baa+bh[1])[baa.index < hy_full.index[0]], hy_full]).sort_index()
    dx_b = d["DTWEXBGS"].s; dx_m = L.fred("DTWEXM"); j = dx_b.index[0]; scale = dx_b.iloc[0]/dx_m.asof(j); dx_ext = pd.concat([(dx_m[dx_m.index < j]*scale), dx_b]).sort_index()
    d = dict(d); d["BAMLH0A0HYM2"] = E.D(hy_ext, 1); d["DTWEXBGS"] = E.D(dx_ext, 4); d["BTC"] = None
    SPLITS = [(None, None), ("1990-01-01", "2002-12-31"), ("2003-01-01", "2014-12-31"), ("2015-01-01", None)]
df0, A = E.build_scores(d, grid, variants=L.CURRENT)
if START < "2003": df0 = df0[[k for k in CORE if k in df0.columns]]

# ---------- my own signal builder (composite + hardMarket + kill-switch) ----------
def signal(df):
    out = E.composite(df, A, variants=L.CURRENT)
    hy = A["hy"]; hym = A["hy_mom"]; vix = A["vix"]; rvol = A.get("ratevol", pd.Series(0.0, index=grid)); jpyu = A.get("jpy_unwind", pd.Series(0.0, index=grid))
    hm = (((hy > 450) & (hym > 75)).astype(float) + (jpyu > 0.5).astype(float) + (vix > 35).astype(float) + (rvol > 10).astype(float))
    f = out["fund_fired"].astype(bool); out["fund"] = f; out["override"] = (f & (hm >= 2)); out["hardMarket"] = hm
    return out

def run(df):
    sig = signal(df); e, rg = ladder_machine(sig); r, ee = simulate(e, trr, cashr, cost_bps=10); return dict(sig=sig, rung=rg, r=r, e=ee)

def zones_pts(ch, hi=10, mid=5, lo=-5):
    sc = pd.Series(np.select([ch > hi, ch > mid, ch > lo], [-2, -1, 0], 1), index=ch.index, dtype=float); sc[ch.isna()] = np.nan; return sc

def to_grid(s):
    s = s[~s.index.duplicated(keep="last")]; return s.reindex(s.index.union(grid)).ffill().reindex(grid)

# --- variants of the VIX card ---
def card_grid_shift(win=21, hi=10, mid=5, lo=-5, extra_shift=0):
    """as in the finding: change computed on the grid-reindexed lagged series A['vix']"""
    v = A["vix"].shift(extra_shift); ch = v - v.shift(win); sc = zones_pts(ch, hi, mid, lo); sc[v.isna()] = np.nan; return sc
def card_raw(win=21, hi=10, mid=5, lo=-5, lag=1):
    """engine-style: change on raw VIX observations, then availability lag -> no leading NaN inside grid"""
    ch = VIXRAW - VIXRAW.shift(win); sc = zones_pts(ch, hi, mid, lo); return to_grid(E.avail_series(sc.dropna(), lag))
def card_cal(days=22, hi=10, mid=5, lo=-5, lag=1):
    ch = E.delta_days(VIXRAW, days); sc = zones_pts(ch, hi, mid, lo); return to_grid(E.avail_series(sc.dropna(), lag))
def card_log(win=21, hi=0.40, mid=0.20, lo=-0.20, lag=1):
    ch = np.log(VIXRAW / VIXRAW.shift(win)); sc = zones_pts(ch, hi, mid, lo); return to_grid(E.avail_series(sc.dropna(), lag))
def card_level(lag=1):
    sc = pd.Series(np.select([VIXRAW < 13, VIXRAW < 20, VIXRAW < 26, VIXRAW < 35], [0, 1, 0, -1], -2), index=VIXRAW.index, dtype=float)
    return to_grid(E.avail_series(sc, lag))
def card_sym(win=21):
    ch = A["vix"] - A["vix"].shift(win)
    sc = pd.Series(np.select([ch > 10, ch > 5, ch > -5, ch > -10], [-2, -1, 0, 1], 2), index=grid, dtype=float); return sc.where(ch.notna())
def card_only_plus(win=21):
    ch = VIXRAW - VIXRAW.shift(win); sc = pd.Series(np.where(ch < -5, 1.0, 0.0), index=VIXRAW.index).where(ch.notna())
    return to_grid(E.avail_series(sc.dropna(), 1))
def with_card(sc):
    df = df0.copy(); df["vix"] = sc; return df

# sanity: my level card == engine's
assert (card_level(1).fillna(-99) == df0["vix"].fillna(-99)).all(), "level card mismatch"

def sh(x, c): return (x - c).mean() * 252 / (x.std() * np.sqrt(252))
def line(name, R):
    s = f"{name:44}"
    for lo, hi in SPLITS:
        rr = R["r"].loc[lo:hi]; m = metrics(rr, cashr.reindex(rr.index))
        s += f" | Sh {m['sharpe']:.3f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {R['e'].loc[lo:hi].mean():.3f}"
    sw = int((R["e"].diff().abs() > 1e-9).sum()) / (len(R["e"]) / 252); s += f" | sw/yr {sw:.1f}"; P(s)

def boot(rA, rB, bl=63, nb=4000, seed=7):
    """circular paired block bootstrap of Sharpe difference (A-B)"""
    a = rA.values; b = rB.values; c = cashr.reindex(rA.index).values; n = len(a); rng = np.random.default_rng(seed)
    nblk = int(np.ceil(n / bl)); obs = sh(a, c) - sh(b, c); diffs = np.empty(nb)
    for i in range(nb):
        st = rng.integers(0, n, nblk); idx = (st[:, None] + np.arange(bl)[None, :]).ravel()[:n] % n
        diffs[i] = sh(a[idx], c[idx]) - sh(b[idx], c[idx])
    return obs, (diffs <= 0).mean(), np.percentile(diffs, [2.5, 97.5])
def hac_t(x, lags=21):
    x = np.asarray(x, float); n = len(x); m = x.mean(); u = x - m; g0 = (u @ u) / n; s = g0
    for k in range(1, lags + 1): s += 2 * (1 - k / (lags + 1)) * (u[:-k] @ u[k:]) / n
    return m * 252 * 1e4, m / np.sqrt(s / n)   # annualized bp, t

P(f"=== rev2 reproduction, grid {grid[0].date()}..{grid[-1].date()} n={len(grid)} | splits: " + " | ".join(f"{a or 'start'}..{b or 'end'}" for a, b in SPLITS))
R = {}
R["BASE"] = run(df0)
R["P1 (grid shift21, as in finding)"] = run(with_card(card_grid_shift()))
R["P1raw (change on raw obs, no lead NaN)"] = run(with_card(card_raw()))
R["DROP vix card"] = run(df0.drop(columns=["vix"]))
R["P1 cal22 (22 calendar days ago)"] = run(with_card(card_cal(22)))
R["P1 cal30 (30 calendar days ago)"] = run(with_card(card_cal(30)))
R["P1 log (+40/+20/-20%)"] = run(with_card(card_log()))
R["P1 log (+50/+25/-25%)"] = run(with_card(card_log(21, 0.5, 0.25, -0.25)))
R["P1raw lag2 (VIX avail +2 cal days)"] = run(with_card(card_raw(lag=2)))
R["BASE lag2 (level card avail +2 cal days)"] = run(with_card(card_level(2)))
R["P1 grid extra 1 trading-day shift"] = run(with_card(card_grid_shift(extra_shift=1)))
R["BASE level extra 1 trading-day shift"] = run(with_card(df0["vix"].shift(1)))
R["P1raw lag0 (same-day close, info only)"] = run(with_card(card_raw(lag=0)))
R["P1 zones shifted +2 (12/7/-3)"] = run(with_card(card_raw(21, 12, 7, -3)))
R["P1 sym zones (+2 below -10)"] = run(with_card(card_sym()))
R["P1 no +1 (falling -> 0)"] = run(with_card(card_raw(21, 10, 5, -1e9)))
R["P1 only +1/0 (rising -> 0)"] = run(with_card(card_only_plus()))
R["P1 5-day change (10/5/-5)"] = run(with_card(card_raw(5)))
R["P1 63-day change (10/5/-5)"] = run(with_card(card_raw(63)))
spx_g0 = spx.reindex(grid).ffill(); ret21 = (spx_g0.shift(1) / spx_g0.shift(22) - 1) * 100   # past 21d SPX return known at close t-1
R["VIX card := SPX 21d ret zones (<-8:-2,<-4:-1,<=4:0,>4:+1)"] = run(with_card(pd.Series(np.select([ret21 < -8, ret21 < -4, ret21 <= 4], [-2, -1, 0], 1), index=grid, dtype=float).where(ret21.notna())))
R["VIX card := copy of spx_mom card"] = run(with_card(df0["spx_mom"].copy()))
R["VIX card := SPX 21d ret, only +1 (>4%) else 0"] = run(with_card(pd.Series(np.where(ret21 > 4, 1.0, 0.0), index=grid).where(ret21.notna())))

P("\n--- (1) metrics ---")
for k, v in R.items(): line(k, v)

P("\n--- (2) paired circular block bootstrap of Sharpe diff (4000 draws) + HAC t of daily return diff ---")
pairs = [("P1 (grid shift21, as in finding)", "BASE"), ("P1raw (change on raw obs, no lead NaN)", "BASE"), ("DROP vix card", "BASE"),
         ("P1 (grid shift21, as in finding)", "DROP vix card"), ("P1raw (change on raw obs, no lead NaN)", "DROP vix card"),
         ("P1 cal22 (22 calendar days ago)", "BASE"), ("P1 log (+40/+20/-20%)", "BASE"), ("P1raw lag2 (VIX avail +2 cal days)", "BASE lag2 (level card avail +2 cal days)"),
         ("P1 grid extra 1 trading-day shift", "BASE level extra 1 trading-day shift")]
for a, b in pairs:
    for lo, hi in SPLITS:
        ra = R[a]["r"].loc[lo:hi]; rb_ = R[b]["r"].loc[lo:hi]
        o63, p63, ci63 = boot(ra, rb_, 63); o126, p126, ci126 = boot(ra, rb_, 126); o21, p21, _ = boot(ra, rb_, 21)
        bp, t = hac_t((ra - rb_).values)
        P(f"  {a[:30]:30} vs {b[:22]:22} {str(lo)[:4] if lo else 'full':>5}..{str(hi)[:4] if hi else 'end':<4}: dSh {o63:+.3f} P<=0 bl21 {p21:.3f} bl63 {p63:.3f} bl126 {p126:.3f} CI63 [{ci63[0]:+.3f},{ci63[1]:+.3f}] | ret diff {bp:+.0f} bp/yr HAC-t {t:+.2f}")

# ---------- (3) calendar-year attribution ----------
P("\n--- (3) per-year: Sharpe BASE / P1 / DROP, cum return diff P1-BASE (pp), timing contribution sum((eP1-eB)*(tr-cash)) (pp), days rung differs ---")
rb = R["BASE"]; rp = R["P1 (grid shift21, as in finding)"]; rd = R["DROP vix card"]
years = sorted(set(grid.year)); tot = 0
for y in years:
    m = grid.year == y
    if m.sum() < 60: continue
    sb = sh(rb["r"][m], cashr[m]); sp = sh(rp["r"][m], cashr[m]); sd = sh(rd["r"][m], cashr[m])
    cd = ((1 + rp["r"][m]).prod() - (1 + rb["r"][m]).prod()) * 100
    tc = ((rp["e"][m] - rb["e"][m]) * (trr[m] - cashr[m])).sum() * 100
    nd = int((rp["rung"][m] != rb["rung"][m]).sum()); tot += cd
    P(f"  {y}: Sh B {sb:+.2f} P1 {sp:+.2f} DROP {sd:+.2f} | dSh(P1-B) {sp-sb:+.2f} | cumret diff {cd:+.2f} pp | timing {tc:+.2f} pp | rung differs {nd:3d} d | E B {rb['e'][m].mean():.2f} P1 {rp['e'][m].mean():.2f}")
dif = rp["r"] - rb["r"]
P(f"  sum of yearly cumret diffs {tot:+.2f} pp; total final-wealth ratio P1/BASE {(1+rp['r']).prod()/(1+rb['r']).prod():.4f}")
top = dif.abs().sort_values(ascending=False)
P(f"  daily diff: n nonzero {(dif.abs()>1e-12).sum()}, top10 |diff| days: " + ", ".join(f"{t.date()} {dif[t]*100:+.2f}%" for t in top.index[:10]))
P(f"  cum diff (sum of daily) {dif.sum()*100:+.2f} pp; ex top-10 days {(dif.sum()-dif[top.index[:10]].sum())*100:+.2f} pp; ex top-20 {(dif.sum()-dif[top.index[:20]].sum())*100:+.2f} pp")
for a_, b_ in [("2008-09-01", "2009-06-30"), ("2020-02-19", "2020-06-30"), ("2022-01-03", "2022-12-31")]:
    P(f"  cum diff inside {a_}..{b_}: {dif.loc[a_:b_].sum()*100:+.2f} pp")
ex = dif.copy(); ex.loc["2008-09-01":"2009-06-30"] = 0; ex.loc["2020-02-19":"2020-06-30"] = 0
P(f"  cum diff EXCLUDING 2008-09..2009-06 and 2020-02..2020-06: {ex.sum()*100:+.2f} pp")
mm = pd.Series(True, index=grid); mm.loc["2008-09-01":"2009-06-30"] = False; mm.loc["2020-02-19":"2020-06-30"] = False
P(f"  Sharpe excluding those two windows: BASE {sh(rb['r'][mm], cashr[mm]):.3f}  P1 {sh(rp['r'][mm], cashr[mm]):.3f}  DROP {sh(rd['r'][mm], cashr[mm]):.3f}")
blk = dif.groupby(grid.year).sum(); P(f"  calendar years P1>BASE on return: {(blk>0).sum()}/{(blk!=0).sum()} nonzero years (ties {(blk==0).sum()})")

# ---------- (4) exposure confound ----------
P("\n--- (4) exposure confound: constant-exposure benchmark with same mean exposure (no costs) ---")
for k in ["BASE", "P1 (grid shift21, as in finding)", "DROP vix card"]:
    for lo, hi in SPLITS:
        e = R[k]["e"].loc[lo:hi]; rr = R[k]["r"].loc[lo:hi]; c = cashr.loc[lo:hi]; t_ = trr.loc[lo:hi]
        eb = e.mean(); rbench = eb * t_ + (1 - eb) * c
        mS = metrics(rr, c); mB = metrics(rbench, c)
        P(f"  {k[:22]:22} {str(lo)[:4] if lo else 'full':>5}..{str(hi)[:4] if hi else 'end':<4}: E {eb:.3f} | strat Sh {mS['sharpe']:.3f} CAGR {mS['cagr']*100:5.2f} DD {mS['maxdd']*100:5.1f} | const-E Sh {mB['sharpe']:.3f} CAGR {mB['cagr']*100:5.2f} DD {mB['maxdd']*100:5.1f} | edge Sh {mS['sharpe']-mB['sharpe']:+.3f} CAGR {(mS['cagr']-mB['cagr'])*100:+.2f}")
bp, t = hac_t(dif.values); P(f"  long-P1/short-BASE: mean {bp:+.0f} bp/yr, HAC t {t:+.2f}, ann vol {dif.std()*np.sqrt(252)*100:.2f}%, Sharpe {dif.mean()*252/(dif.std()*np.sqrt(252)):.3f}")
dd2 = rp["r"] - rd["r"]; bp, t = hac_t(dd2.values); P(f"  long-P1/short-DROP: mean {bp:+.0f} bp/yr, HAC t {t:+.2f}, Sharpe {dd2.mean()*252/(dd2.std()*np.sqrt(252)):.3f}")

# ---------- (5) card scores on dates + rung paths ----------
P("\n--- (5) VIX card on dates (value used at t = close of t-1; ch = 21 trading-day change of that) ---")
dates = ["2008-10-10", "2008-12-31", "2009-04-01", "2020-03-16", "2020-04-30", "2022-06-15", "2024-08-05", "2025-04-08", "2025-05-15", str(grid[-1].date())]
c1 = card_grid_shift(); v = A["vix"]; ch = v - v.shift(21)
for ds in dates:
    t = grid[grid.get_indexer([pd.Timestamp(ds)], method="pad")[0]]
    P(f"  {ds} (grid {t.date()}): VIX(t-1) {v[t]:6.2f} VIX 21d ago {v.shift(21)[t]:6.2f} ch {ch[t]:+6.2f} | card BASE {df0['vix'][t]:+.0f} P1 {c1[t]:+.0f} | comp B {rb['sig']['composite'][t]:+6.1f} P1 {rp['sig']['composite'][t]:+6.1f} | rung B {int(rb['rung'][t])} P1 {int(rp['rung'][t])} | cover B {rb['sig']['cover'][t]:.2f} P1 {rp['sig']['cover'][t]:.2f}")
for w0, w1 in [("2020-02-14", "2020-07-03"), ("2022-01-03", "2022-12-30"), ("2008-09-01", "2009-06-30")]:
    seg = grid[(grid >= w0) & (grid <= w1)]
    s = ""
    for t in seg:
        if t.dayofweek == 4 or t == seg[-1]:
            s += f"{t.strftime('%m-%d')}:{int(rb['rung'][t])}/{int(rp['rung'][t])} "
    P(f"  [{w0}..{w1}] rung path, Fridays (fmt date:BASE/P1)"); P("   " + s)
    P(f"   days rung differs {int((rb['rung'][seg]!=rp['rung'][seg]).sum())}/{len(seg)}; mean E BASE {rb['e'][seg].mean():.2f} P1 {rp['e'][seg].mean():.2f}; cum ret BASE {((1+rb['r'][seg]).prod()-1)*100:+.1f}% P1 {((1+rp['r'][seg]).prod()-1)*100:+.1f}% BH {((1+trr[seg]).prod()-1)*100:+.1f}%")

# ---------- (6) mechanics ----------
P("\n--- (6) mechanics / artifacts ---")
P(f"  P1 card NaN days inside grid: {int(c1.isna().sum())} (BASE NaN: {int(df0['vix'].isna().sum())}); first non-NaN P1 date {c1.first_valid_index().date()}")
P(f"  coverage differs on {int((rb['sig']['cover']!=rp['sig']['cover']).sum())} days; min cover BASE {rb['sig']['cover'].min():.2f} P1 {rp['sig']['cover'].min():.2f}; cover<0.6 days BASE {int((rb['sig']['cover']<0.6).sum())} P1 {int((rp['sig']['cover']<0.6).sum())}")
P(f"  rung differs on {int((rb['rung']!=rp['rung']).sum())}/{len(grid)} days ({(rb['rung']!=rp['rung']).mean()*100:.1f}%); mean |composite diff| {(rp['sig']['composite']-rb['sig']['composite']).abs().mean():.2f} pts; max {(rp['sig']['composite']-rb['sig']['composite']).abs().max():.1f}")
ct = pd.crosstab(df0["vix"].fillna(9).astype(int), c1.fillna(9).astype(int)); P("  crosstab BASE card (rows) x P1 card (cols), 9=NaN:"); P(ct.to_string())
P(f"  card score distribution: BASE mean {df0['vix'].mean():+.3f}  P1 mean {c1.mean():+.3f}")
for k in ["BASE", "P1 (grid shift21, as in finding)", "DROP vix card"]:
    P(f"  rung share {k[:22]:22}: " + str({int(a): round(b*100, 1) for a, b in R[k]["rung"].value_counts(normalize=True).sort_index().items()}))
spx_g = spx.reindex(grid).ffill(); fwd21 = np.log(spx_g.shift(-21) / spx_g); r21 = np.log(spx_g.shift(-1)/spx_g.shift(20))
P(f"  corr(P1 card, BASE card) {c1.corr(df0['vix']):+.3f}; corr(P1 card, past 21d SPX ret) {c1.corr(r21):+.3f}; corr(BASE card, past 21d SPX ret) {df0['vix'].corr(r21):+.3f}")
P(f"  IC (Spearman) with fwd 21d SPX log-ret: BASE card {df0['vix'].corr(fwd21, method='spearman'):+.4f}  P1 card {c1.corr(fwd21, method='spearman'):+.4f}  spx_mom card {df0['spx_mom'].corr(fwd21, method='spearman'):+.4f}")
pd.DataFrame({"e_base": rb["e"], "e_p1": rp["e"], "e_drop": rd["e"], "r_base": rb["r"], "r_p1": rp["r"], "r_drop": rd["r"], "rung_base": rb["rung"], "rung_p1": rp["rung"], "card_base": df0["vix"], "card_p1": c1, "comp_base": rb["sig"]["composite"], "comp_p1": rp["sig"]["composite"]}).to_csv(os.path.join(HERE, "out", f"rev2_series_{START[:4]}.csv"))
OUT.close()
