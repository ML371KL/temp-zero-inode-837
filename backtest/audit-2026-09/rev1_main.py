# -*- coding: utf-8 -*-
"""REV1: adversarial re-computation of audit claims C1..C5 on the live-logic (CURRENT) replica.
Run:  PYTHONIOENCODING=utf-8 python rev1_main.py > out/rev1_main.txt
Sections: A look-ahead empirics; B IC with non-overlapping samples / Kendall; C verdict returns ex-crisis;
D PROTECT entries & deep-drawdown exposure; E baseline & ex-crisis; F ablation vs exposure-level artifact."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from scipy import stats
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, metrics, RUNG_PCT

pd.set_option("display.width", 250); pd.set_option("display.max_columns", 40); pd.set_option("display.max_rows", 400)
d = L.load_all(); spx = d["SPX"].s; tr = d["SP500TR"].s; cash = d["DTB3"].s/100/252
grid = spx.loc["2003-01-01":].index
df, A = E.build_scores(d, grid); out = E.composite(df, A)
trg = tr.reindex(grid).ffill(); cashg = cash.reindex(grid).ffill().fillna(0)
trr = tr.pct_change().reindex(grid).fillna(0.0); cashr = cashg
H = {"1m":21, "3m":63, "6m":126, "12m":252}
fwd = {}
for k,h in H.items():
    fwd[k] = np.log(trg.shift(-h)/trg) - cashg.rolling(h).sum().shift(-h)
fwd = pd.DataFrame(fwd)

def hard_market(A, grid):
    hy=A.get("hy",pd.Series(np.nan,index=grid)); hymom=A.get("hy_mom",pd.Series(np.nan,index=grid))
    vix=A.get("vix",pd.Series(np.nan,index=grid)); rvol=A.get("ratevol",pd.Series(0.0,index=grid)); jpyu=A.get("jpy_unwind",pd.Series(0.0,index=grid))
    return (((hy>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vix>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))
HM = hard_market(A, grid)
def mk_sig(dfx, Ax=A):
    o = E.composite(dfx, Ax); f = o["fund_fired"].astype(bool)
    o["fund"] = f; o["override"] = (f & (HM>=2)).astype(bool); o["hardMarket"] = HM; return o
sig = mk_sig(df)
expo, rung = ladder_machine(sig)
r_dash, e_dash = simulate(expo, trr, cashr, cost_bps=10)
r_bh, _ = simulate(pd.Series(1.0, index=grid), trr, cashr, cost_bps=0)

def sh(x, c=None):
    c = cashr.reindex(x.index) if c is None else c
    return (x - c).mean()*252/(x.std()*np.sqrt(252))

# ============================================================================
print("=== A. LOOK-AHEAD EMPIRICS ===")
# A1: market-derived scores must react to YESTERDAY's return, not today's.
r_spx = np.log(spx.reindex(grid)).diff()
for k in ["spx", "spx_mom", "vix", "hy_mom", "hy", "oil"]:
    ds = df[k].diff()
    c0 = ds.corr(r_spx)            # score change at t vs return close(t-1)->close(t)
    c1 = ds.corr(r_spx.shift(1))   # vs return close(t-2)->close(t-1)
    c2 = ds.corr(r_spx.shift(2))
    print(f"  d{k:8}: corr with r(t) {c0:+.3f} | r(t-1) {c1:+.3f} | r(t-2) {c2:+.3f}   (lag correct if |r(t-1)| >> |r(t)|)")
# A2: compare engine spx_mom score with a same-day (leaky) reconstruction to measure the lag in trading days
mom_obs = ((spx/spx.reindex(spx.index-pd.Timedelta(days=28), method="ffill").values-1)*100)
sc_leak = pd.Series(np.select([mom_obs>3, mom_obs>-3, mom_obs>-7],[1,0,-1],-2), index=spx.index, dtype=float).reindex(grid)
for lagd in range(0,4):
    print(f"  spx_mom engine == same-day rule shifted {lagd}d: match {(df['spx_mom']==sc_leak.shift(lagd)).mean()*100:.1f}%")
# A3: exposure vs return alignment: strategy return uses e(t-1)*r(t); check corr(e_used(t), r(t)) small vs corr(e(t), r(t))
print(f"  corr(exposure_used(t), r(t)) = {e_dash.corr(trr):+.4f} ; corr(expo signal(t), r(t)) = {expo.corr(trr):+.4f} ; corr(expo(t), r(t-1)) = {expo.corr(trr.shift(1)):+.4f}")
# A4: perfect-foresight sanity: if simulate leaked, expo=1{r(t+1)>0} would produce huge Sharpe
pf = (trr.shift(-1) > 0).astype(float)
rpf,_ = simulate(pf, trr, cashr, cost_bps=0)
print(f"  simulate() with expo=1{{r(t+1)>0}} -> Sharpe {sh(rpf):.2f} (leak-free should be ~market: {sh(r_bh):.2f}); with expo=1{{r(t)>0}} (would need t+1 shift) -> {sh(simulate((trr>0).astype(float),trr,cashr,0)[0]):.2f}")
# A5: publication lags: what fraction of trading days is each macro indicator's score changed on a plausible release weekday?
for k, lagk in [("payrolls",35),("sahm",35),("sloos",35),("claims",12),("nfci",5),("netliq",2)]:
    ch = df[k].diff().fillna(0) != 0
    wd = pd.Series(grid[ch].dayofweek).value_counts().sort_index()
    print(f"  {k:9} lag {lagk:3}d: score-change weekdays (Mon..Fri counts) {wd.reindex(range(5)).fillna(0).astype(int).tolist()}")

# ============================================================================
print("\n=== B. IC ROBUSTNESS: non-overlapping samples, Kendall tau, block bootstrap with block >= horizon ===")
def spear(x,y):
    m = pd.concat([x,y],axis=1).dropna(); return stats.spearmanr(m.iloc[:,0],m.iloc[:,1]).correlation, len(m)
def kend(x,y):
    m = pd.concat([x,y],axis=1).dropna(); return stats.kendalltau(m.iloc[:,0],m.iloc[:,1]).correlation
def nonoverlap(x, y, h):
    """IC over all non-overlapping phases (every h trading days, offset 0..h-1 step 5); returns mean IC, share of phases<0, median n, median p."""
    ics=[]; ps=[]; ns=[]
    for off in range(0, h, 5):
        idx = grid[off::h]
        m = pd.concat([x.reindex(idx), y.reindex(idx)],axis=1).dropna()
        if len(m) < 12: continue
        rho, p = stats.spearmanr(m.iloc[:,0], m.iloc[:,1])
        ics.append(rho); ps.append(p); ns.append(len(m))
    if not ics: return (np.nan,)*6
    ics=np.array(ics)
    return ics.mean(), (ics<0).mean(), int(np.median(ns)), np.median(ps), ics.min(), ics.max()
def blockboot(x, y, bl, nb=1000, seed=0):
    wk = grid[::5]
    m = pd.concat([x.reindex(wk), y.reindex(wk)],axis=1).dropna()
    xv=m.iloc[:,0].values; yv=m.iloc[:,1].values; n=len(m); rng=np.random.default_rng(seed); nblk=int(np.ceil(n/bl)); ics=[]
    for _ in range(nb):
        st=rng.integers(0,n-bl,nblk); idx=np.concatenate([np.arange(s,s+bl) for s in st])[:n]
        ics.append(stats.spearmanr(xv[idx],yv[idx]).correlation)
    return np.percentile(ics,[2.5,97.5])
blk = {}
for b in E.W:
    inds=[k for k,v in E.FAM.items() if v[0]==b and k in df.columns]; fams={}
    for k in inds: fams.setdefault(E.FAM[k][1],[]).append(k)
    blk[b]=pd.concat([df[ks].mean(axis=1) for ks in fams.values()],axis=1).mean(axis=1)/2*100
series = {"composite":out["composite"], "comp_raw":out["comp_raw"], "coin":out["coin"], "lead":out["lead"], "detpts":out["detpts"],
          "block_credit":blk["credit"], "block_plumb":blk["plumb"], "block_regime":blk["regime"]}
for k in ["hy","ig","sloos","sahm","vix","claims","spx","hy_mom","spx_mom","real10","oil","btc"]: series[k]=df[k]
rows=[]
for name, s in series.items():
    for hk,h in H.items():
        ic_w, n_w = spear(s.reindex(grid[::5]), fwd[hk].reindex(grid[::5]))
        lo13, hi13 = blockboot(s, fwd[hk], 13)
        loH, hiH = blockboot(s, fwd[hk], max(13, 2*h//5))
        icn, negsh, nn, pmed, icmin, icmax = nonoverlap(s, fwd[hk], h)
        kt = kend(s.reindex(grid[::h]), fwd[hk].reindex(grid[::h]))
        rows.append(dict(series=name, h=hk, ic_weekly=ic_w, ci13=f"[{lo13:+.2f},{hi13:+.2f}]", ci2h=f"[{loH:+.2f},{hiH:+.2f}]",
                         ic_nonovl=icn, ic_nonovl_min=icmin, ic_nonovl_max=icmax, share_neg=negsh, n_nonovl=nn, p_med=pmed, kendall=kt))
R = pd.DataFrame(rows)
print(R.round(3).to_string(index=False))
print("\n  Interpretation aid: ci13 = a1's bootstrap (block 13 weeks); ci2h = block = 2x horizon; ic_nonovl = mean over phase-shifted non-overlapping samples; p_med = median Spearman p across phases.")

# ============================================================================
print("\n=== C. VERDICT-CONDITIONAL RETURNS: full vs ex-crisis, day-weighted vs episode-weighted ===")
v = E.verdict_series(out)
usrec = L.fred("USRECD") if os.path.exists(os.path.join(L.DATA,"USRECD.csv")) else (L.fred("USREC") if os.path.exists(os.path.join(L.DATA,"USREC.csv")) else None)
rec = usrec.reindex(grid, method="ffill").fillna(0) if usrec is not None else None
masks = {"full": pd.Series(True, index=grid)}
m1 = pd.Series(True, index=grid); m1.loc["2008-01-01":"2009-12-31"] = False; m1.loc["2020-01-01":"2020-12-31"] = False
masks["ex 2008-09 & 2020"] = m1
m2 = m1.copy(); m2.loc["2022-01-01":"2022-12-31"] = False; masks["ex 2008-09, 2020, 2022"] = m2
if rec is not None: masks["ex NBER recessions"] = (rec == 0)
for mname, msk in masks.items():
    print(f"\n  --- {mname} (days {int(msk.sum())}) ---")
    for hk in ("1m","3m","12m"):
        line=f"  {hk:4}"
        for vv in ["PROTECT","REDUCE","HOLD","HOLD+","BUY"]:
            x = fwd[hk][(v==vv)&msk].dropna()
            if len(x): line += f"  {vv}: {x.mean()*252/H[hk]*100:+.1f}% (n={len(x)}, hit {(x>0).mean()*100:.0f}%)"
        print(line)
# episode weighting: contiguous runs of the same verdict (gap<=5 days merged), mean of per-episode mean forward 3m
print("\n  Episode-weighted (each contiguous verdict run counts once; fwd 3m / 12m excess, annualized):")
vv_ = v.copy(); ep_id = (vv_ != vv_.shift()).cumsum()
epi = pd.DataFrame({"v":vv_, "ep":ep_id, "f3":fwd["3m"], "f12":fwd["12m"]})
g = epi.groupby("ep").agg(v=("v","first"), start=("f3", lambda s: s.index[0]), n=("v","size"), f3=("f3","mean"), f12=("f12","mean"))
g = g[g.n >= 5]
for vv in ["PROTECT","REDUCE","HOLD","HOLD+","BUY"]:
    x = g[g.v==vv]
    print(f"    {vv:8}: episodes {len(x):3} | mean-of-episode fwd3m {x.f3.mean()*4*100:+.1f}%/yr  (median {x.f3.median()*4*100:+.1f}) | fwd12m {x.f12.mean()*100:+.1f}% (median {x.f12.median()*100:+.1f}) | share of episodes with fwd3m<0: {(x.f3<0).mean()*100:.0f}%")
print("\n  PROTECT episodes (>=5 days):")
print(g[g.v=="PROTECT"].assign(f3=lambda t: (t.f3*100).round(1), f12=lambda t:(t.f12*100).round(1)).to_string())
# what share of PROTECT days lie in 2008-09 / 2020 / 2022
pd_days = (v=="PROTECT")
print(f"\n  PROTECT days: total {int(pd_days.sum())}; in 2008-09 {int(pd_days.loc['2008':'2009'].sum())}; in 2020 {int(pd_days.loc['2020'].sum())}; in 2022 {int(pd_days.loc['2022'].sum())}; other {int(pd_days.sum()-pd_days.loc['2008':'2009'].sum()-pd_days.loc['2020'].sum()-pd_days.loc['2022'].sum())}")

# ============================================================================
print("\n=== D. PROTECT (rung 0) ENTRIES and deep-drawdown exposure ===")
ch = rung.diff().fillna(0); ent = grid[(ch<0)&(rung==0)]
p = spx.reindex(grid).ffill(); dd252 = (p/p.rolling(252).max()-1)*100
ex_tr = lambda h: (np.log(trg.shift(-h)/trg) - cashg.rolling(h).sum().shift(-h))*100   # excess, from close t
ex_tr1 = lambda h: ex_tr(h).shift(-1)   # from execution close t+1
rows=[]
for t in ent:
    rows.append(dict(date=t.date(), dd_at=round(dd252[t],1), ov=bool(sig["override"][t]),
                     x1m=round(ex_tr1(21)[t],1), x3m=round(ex_tr1(63)[t],1), x6m=round(ex_tr1(126)[t],1), x12m=round(ex_tr1(252)[t],1)))
EN = pd.DataFrame(rows); print(EN.to_string(index=False))
print(f"  n entries into rung 0: {len(EN)} (override-driven: {int(EN.ov.sum())})")
for hk,c in [("3m","x3m"),("6m","x6m"),("12m","x12m")]:
    print(f"  losses avoided at {hk} (excess<0): {int((EN[c]<0).sum())}/{len(EN)} ; mean excess fwd {EN[c].mean():+.1f}% ; among dd_at<-10: {int((EN[EN.dd_at<-10][c]<0).sum())}/{len(EN[EN.dd_at<-10])} losses, mean {EN[EN.dd_at<-10][c].mean():+.1f}%")
# time spent at rung 0 and what the market did meanwhile (the realised opportunity cost)
r0 = (rung==0)
print(f"  days at rung 0: {int(r0.sum())}; market excess return while at rung 0 (sum of daily excess, using next-day execution): {((trr-cashr)[r0.shift(1).fillna(False)].sum()*100):+.1f}%")
by_year = ((trr-cashr)[r0.shift(1).fillna(False)]).groupby(lambda t: t.year).sum()*100
print("  by year:", by_year.round(1).to_dict())
deep = dd252 < -20
print(f"  days SPX >20% below 1y high: {int(deep.sum())}; avg exposure (used) {e_dash[deep].mean():.2f}; by year: {e_dash[deep].groupby(lambda t:t.year).mean().round(2).to_dict()}")
f12 = (trg.shift(-252)/trg-1)*100
print(f"  fwd 12m total return from deep-dd days: mean {f12[deep].mean():+.1f}%; by year {f12[deep].groupby(lambda t:t.year).mean().round(1).to_dict()}")
print("  -> distinct deep-drawdown episodes:", int(((deep!=deep.shift())&deep).sum()))

# ============================================================================
print("\n=== E. BASELINE: replication, ex-crisis, sensitivity, significance vs buy&hold ===")
mb = metrics(r_dash, cashr); mh = metrics(r_bh, cashr)
print(f"  DASH  Sh {mb['sharpe']:.3f} DD {mb['maxdd']*100:.1f} CAGR {mb['cagr']*100:.2f}  | B&H Sh {mh['sharpe']:.3f} DD {mh['maxdd']*100:.1f} CAGR {mh['cagr']*100:.2f}")
crash = pd.Series(False, index=grid)
for a_,b_ in [("2008-09-01","2009-06-30"),("2020-02-19","2020-06-30")]: crash.loc[a_:b_] = True
print(f"  ex-GFC/COVID (a7 windows): DASH {sh(r_dash[~crash]):.3f}  B&H {sh(r_bh[~crash]):.3f}")
crash2 = pd.Series(False, index=grid)
for a_,b_ in [("2007-10-01","2009-06-30"),("2020-02-19","2020-06-30")]: crash2.loc[a_:b_] = True
print(f"  ex-2007-10..2009-06 & COVID:   DASH {sh(r_dash[~crash2]):.3f}  B&H {sh(r_bh[~crash2]):.3f}")
crash3 = crash2.copy(); crash3.loc["2022-01-01":"2022-12-31"] = True
print(f"  ... also ex-2022:              DASH {sh(r_dash[~crash3]):.3f}  B&H {sh(r_bh[~crash3]):.3f}")
def paired_boot(rA, rB, nb=2000, bl=63, seed=11):
    a=rA.values; b=rB.values; c=cashr.reindex(rA.index).values; n=len(a); rng=np.random.default_rng(seed); nblk=int(np.ceil(n/bl)); diffs=[]
    f=lambda x,cc:(x-cc).mean()*252/(x.std()*np.sqrt(252))
    obs=f(a,c)-f(b,c)
    for _ in range(nb):
        st=rng.integers(0,n-bl,nblk); idx=np.concatenate([np.arange(s,s+bl) for s in st])[:n]
        diffs.append(f(a[idx],c[idx])-f(b[idx],c[idx]))
    diffs=np.array(diffs); return obs,(diffs<=0).mean(),np.percentile(diffs,[2.5,97.5])
o,pv,ci = paired_boot(r_dash, r_bh); print(f"  paired block-bootstrap dSharpe DASH-B&H full: {o:+.3f} P(<=0)={pv:.3f} CI[{ci[0]:+.3f},{ci[1]:+.3f}]")
o,pv,ci = paired_boot(r_dash[~crash], r_bh[~crash]); print(f"  ... ex-GFC/COVID: {o:+.3f} P(<=0)={pv:.3f} CI[{ci[0]:+.3f},{ci[1]:+.3f}]")
for cost in (0, 10, 25, 50):
    rr,_ = simulate(expo, trr, cashr, cost_bps=cost); print(f"  cost {cost:2}bp: Sh {sh(rr):.3f} CAGR {metrics(rr,cashr)['cagr']*100:.2f}")
for lagx in (1, 2, 3):
    rr,_ = simulate(expo, trr, cashr, cost_bps=10, exec_lag=lagx); print(f"  exec_lag {lagx}: Sh {sh(rr):.3f} CAGR {metrics(rr,cashr)['cagr']*100:.2f} DD {metrics(rr,cashr)['maxdd']*100:.1f}")
# calendar-year excess of DASH over constant-matched exposure
rc,_ = simulate(pd.Series(e_dash.mean(), index=grid), trr, cashr, cost_bps=0)
yr = ((1+r_dash).groupby(lambda t:t.year).prod() - (1+rc).groupby(lambda t:t.year).prod())*100
print("  DASH minus const-matched, calendar-year return diff (pp):", yr.round(1).to_dict())
print(f"  sum of positive years {yr[yr>0].sum():+.1f}pp vs negative {yr[yr<0].sum():+.1f}pp; years with positive diff: {(yr>0).sum()}/{len(yr)}")

# ============================================================================
print("\n=== F. LEAVE-ONE-OUT: exposure level, Jensen alpha, IR vs const-matched, ranking stability, noise level ===")
def jensen(r, lo=None, hi=None):
    rr = r.loc[lo:hi]; m = trr.loc[lo:hi]; c = cashr.loc[lo:hi]
    y = (rr-c).values; x = (m-c).values
    b = np.cov(x,y)[0,1]/np.var(x); a = (y.mean()-b*x.mean())*252
    resid = y - b*x; ir = resid.mean()*252/(resid.std()*np.sqrt(252))
    return a, b, ir
def stats_for(r, e, lo=None, hi=None):
    rr=r.loc[lo:hi]; m=metrics(rr, cashr.reindex(rr.index)); a,b,ir=jensen(r,lo,hi)
    rc_,_=simulate(pd.Series(e.loc[lo:hi].mean(), index=rr.index), trr.loc[lo:hi], cashr.loc[lo:hi], 0)
    diff = rr - rc_; ir2 = diff.mean()*252/(diff.std()*np.sqrt(252)) if diff.std()>0 else 0
    return dict(sh=m["sharpe"], E=e.loc[lo:hi].mean(), alpha=a, beta=b, IR=ir, IRc=ir2, cagr=m["cagr"])
splits=[("full",None,None),("H1","2003-01-01","2014-12-31"),("H2","2015-01-01",None)]
base = {nm: stats_for(r_dash, e_dash, lo, hi) for nm,lo,hi in splits}
print("  BASELINE:", {nm:{k:round(v,3) for k,v in s.items()} for nm,s in base.items()})
rows=[]; runs={}
for k in df.columns:
    s2 = mk_sig(df.drop(columns=[k])); e2,_ = ladder_machine(s2); r2,ee2 = simulate(e2, trr, cashr, 10); runs[k]=(r2,ee2)
    rec_={"ind":k, "const_share": df[k].value_counts(normalize=True).iloc[0]}
    for nm,lo,hi in splits:
        st=stats_for(r2, ee2, lo, hi); b=base[nm]
        rec_[f"dSh_{nm}"]=st["sh"]-b["sh"]; rec_[f"dE_{nm}"]=st["E"]-b["E"]; rec_[f"dAlpha_{nm}"]=(st["alpha"]-b["alpha"])*100; rec_[f"dIR_{nm}"]=st["IR"]-b["IR"]; rec_[f"dIRc_{nm}"]=st["IRc"]-b["IRc"]
    rows.append(rec_)
F = pd.DataFrame(rows).set_index("ind").sort_values("dSh_full", ascending=False)
print(F.round(3).to_string())
print("\n  rank correlation (Spearman) between dSharpe and dAlpha across 28 ablations:", {nm: round(stats.spearmanr(F[f"dSh_{nm}"],F[f"dAlpha_{nm}"]).correlation,3) for nm,_,_ in splits})
print("  rank correlation between dSharpe and dE (exposure level):", {nm: round(stats.spearmanr(F[f"dSh_{nm}"],F[f"dE_{nm}"]).correlation,3) for nm,_,_ in splits})
print("  rank correlation between dCAGR-proxy dE and dAlpha:", {nm: round(stats.spearmanr(F[f"dE_{nm}"],F[f"dAlpha_{nm}"]).correlation,3) for nm,_,_ in splits})
print("  removal improves Sharpe in BOTH halves:", list(F[(F.dSh_H1>0)&(F.dSh_H2>0)].index))
print("  removal improves Jensen alpha in BOTH halves:", list(F[(F.dAlpha_H1>0)&(F.dAlpha_H2>0)].index))
print("  removal improves IR(vs const-matched) in BOTH halves:", list(F[(F.dIRc_H1>0)&(F.dIRc_H2>0)].index))
print("  removal HURTS Sharpe in both halves (valuable):", list(F[(F.dSh_H1<0)&(F.dSh_H2<0)].index))
print("  removal HURTS alpha in both halves:", list(F[(F.dAlpha_H1<0)&(F.dAlpha_H2<0)].index))
print("  removal HURTS IRc in both halves:", list(F[(F.dIRc_H1<0)&(F.dIRc_H2<0)].index))
# noise level: paired bootstrap p-values for extremes
print("\n  paired block-bootstrap (63d) of dSharpe vs baseline, full window:")
for k in list(F.index[:4]) + list(F.index[-4:]):
    o,pv,ci = paired_boot(runs[k][0], r_dash); print(f"    - {k:9}: dSh {o:+.3f}  P(<=0)={pv:.3f}  CI[{ci[0]:+.3f},{ci[1]:+.3f}]")
# jpy: replace with a constant -2 and see whether anything changes
dfj = df.copy(); dfj["jpy"] = -2.0
s3 = mk_sig(dfj); e3,_ = ladder_machine(s3); r3,ee3 = simulate(e3, trr, cashr, 10)
print(f"\n  jpy := constant -2 : Sh {sh(r3):.3f} vs baseline {sh(r_dash):.3f}; exposure path identical on {(e3==e_dash).mean()*100:.1f}% of days")
# block ablation with alpha
print("\n  Leave-one-BLOCK-out (dSharpe / dAlpha pp / dE) full | H1 | H2:")
for b in E.W:
    ks=[k for k in df.columns if E.FAM[k][0]==b]
    s2=mk_sig(df.drop(columns=ks)); e2,_=ladder_machine(s2); r2,ee2=simulate(e2,trr,cashr,10)
    line=f"    - {b:7}"
    for nm,lo,hi in splits:
        st=stats_for(r2,ee2,lo,hi); bb=base[nm]; line+=f" | {st['sh']-bb['sh']:+.3f} / {(st['alpha']-bb['alpha'])*100:+.2f} / {st['E']-bb['E']:+.3f}"
    o,pv,ci=paired_boot(r2,r_dash); line+=f" | boot P(dSh<=0)={pv:.2f}"
    print(line)
# random-drop placebo: drop a random subset of 1 indicator repeatedly is the ablation itself; instead: shuffle which indicator is dropped is meaningless.
# Placebo: replace ONE indicator by an iid random score with the same marginal distribution, 28 x 5 seeds -> distribution of dSharpe
rng=np.random.default_rng(1); pl=[]
for k in df.columns:
    for sd in range(3):
        dfp=df.copy(); vals=df[k].dropna().values; dfp[k]=pd.Series(rng.choice(vals, size=len(df)), index=grid).where(df[k].notna())
        s2=mk_sig(dfp); e2,_=ladder_machine(s2); r2,_=simulate(e2,trr,cashr,10); pl.append(sh(r2)-sh(r_dash))
pl=np.array(pl); print(f"\n  placebo (indicator -> iid shuffle of its own scores), 84 runs: dSharpe mean {pl.mean():+.3f}, sd {pl.std():.3f}, 5-95% [{np.percentile(pl,5):+.3f},{np.percentile(pl,95):+.3f}], share>0 {(pl>0).mean()*100:.0f}%")
print("  (compare: observed leave-one-out dSharpe full ranges from", round(F.dSh_full.min(),3), "to", round(F.dSh_full.max(),3), ")")
F.to_csv("out/rev1_ablation.csv"); R.to_csv("out/rev1_ic.csv", index=False)
print("\nsaved out/rev1_ablation.csv out/rev1_ic.csv")
