# -*- coding: utf-8 -*-
"""A5: redesign hypotheses, tested on the same PIT engine.
Each variant transforms the score DataFrame (df) and/or composite/ladder rules, then runs the
ladder strategy. Reported on 2003-2026 full + halves, and on 1990-2026 core (proxy credit).
Variants are deliberately few and economically motivated (no parameter sweeps)."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, metrics, rung_from, RUNG_PCT

d = L.load_all()
spx=d["SPX"].s; tr=d["SP500TR"].s; cash=d["DTB3"].s/100/252

def hard_market(A, grid):
    hy=A.get("hy",pd.Series(np.nan,index=grid)); hymom=A.get("hy_mom",pd.Series(np.nan,index=grid))
    vix=A.get("vix",pd.Series(np.nan,index=grid)); rvol=A.get("ratevol",pd.Series(0.0,index=grid)); jpyu=A.get("jpy_unwind",pd.Series(0.0,index=grid))
    return (((hy>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vix>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))

def composite_w(df, A, W=None):
    """engine.composite with custom block weights."""
    oldW=dict(E.W)
    if W: E.W.clear(); E.W.update(W)
    try: out=E.composite(df,A)
    finally: E.W.clear(); E.W.update(oldW)
    return out

def mk_sig(df,A,grid,W=None):
    out=composite_w(df,A,W); HM=hard_market(A,grid); f=out["fund_fired"].astype(bool)
    out["fund"]=f; out["override"]=(f&(HM>=2)).astype(bool); out["hardMarket"]=HM; return out

# ---------- transformations ----------
def cap_duration(df, inds, K_days, floor_after=0.0):
    """score of `inds` that has been <= -1 continuously for more than K_days trading days is raised to floor_after."""
    df=df.copy()
    for k in inds:
        if k not in df: continue
        s=df[k]; neg=(s<=-1).astype(int)
        run=neg.groupby((neg!=neg.shift()).cumsum()).cumsum()   # length of current negative run
        df.loc[(run>K_days)&(s<=-1),k]=np.maximum(s[(run>K_days)&(s<=-1)],floor_after)
    return df

def hy_relative(df, A):
    """HY level score replaced by regime-aware relative rule:
       z = (hy - 252d mean)/252d std (PIT). widening & wide -> -2 ; wide but not widening -> +1 (recovery) ; tight -> +1 ; normal -> 0"""
    df=df.copy(); hy=A["hy"]; mom=A["hy_mom"]
    z=(hy-hy.rolling(252,min_periods=120).mean())/hy.rolling(252,min_periods=120).std()
    sc=pd.Series(0.0,index=df.index)
    sc[(z>1.0)&(mom>25)]=-2
    sc[(z>1.0)&(mom<=25)&(mom>0)]=-1
    sc[(z>1.0)&(mom<=0)]=1
    sc[(z<-0.5)]=1
    sc[z.isna()]=np.nan
    df["hy"]=sc
    return df

def reentry_floor(expo, grid, floor=0.65, kind="50dma"):
    """trend-based re-entry: when price above 50DMA (or 200DMA) and above its 20d-ago level, exposure floor."""
    p=spx.reindex(grid).ffill()
    if kind=="50dma": cond=(p>p.rolling(50).mean())&(p>p.shift(20))
    else: cond=(p>p.rolling(200).mean())
    cond=cond.shift(1).fillna(False)   # PIT: signal known at close t-1 for exposure at t (simulate shifts again)
    e=expo.copy(); e[cond]=np.maximum(e[cond],floor); return e

def run_variant(name, df, A, grid, trr, cashr, W=None, post=None, splits=None, gate=(10,-10)):
    sig=mk_sig(df,A,grid,W)
    e,r_=ladder_machine(sig,gate=gate)
    if post: e=post(e)
    r,ee=simulate(e,trr,cashr,cost_bps=10)
    s=f"{name:46}"
    for lo,hi in splits:
        rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index))
        s+=f" | Sh {m['sharpe']:.2f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
    sw=int((ee.diff().abs()>1e-9).sum())/ (len(ee)/252)
    s+=f" | sw/yr {sw:.1f}"
    print(s); return r,e

def block(name, grid_start, d_, core=None):
    grid=spx.loc[grid_start:].index
    trr=tr.pct_change().reindex(grid).fillna(0.0); cashr=cash.reindex(grid).ffill().fillna(0.0)
    df,A=E.build_scores(d_,grid)
    if core: df=df[[k for k in core if k in df.columns]]
    if grid_start<"2000": splits=[(None,None),("1990-01-01","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01",None)]
    else: splits=[(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)]
    print(f"\n=== {name}: {grid[0].date()}..{grid[-1].date()} | cols: "+" | ".join(f"{a or 'start'}..{b or 'end'}" for a,b in splits)+" ===")
    r0,e0=run_variant("BASELINE as built",df,A,grid,trr,cashr,splits=splits)
    bh=pd.Series(1.0,index=grid); rb,_=simulate(bh,trr,cashr,cost_bps=0)
    s="Buy&Hold".ljust(46)
    for lo,hi in splits:
        rr=rb.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index)); s+=f" | Sh {m['sharpe']:.2f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E 1.00"
    print(s)
    # H2: duration caps on level indicators
    LEVEL=["hy","ig","sloos","sahm","payrolls","nfci","reserves","vix","spx"]
    for K in (63,126):
        run_variant(f"H2 duration cap {K}d on level inds -> 0",cap_duration(df,LEVEL,K,0.0),A,grid,trr,cashr,splits=splits)
    run_variant("H2b duration cap 126d -> -1 (soft)",cap_duration(df,LEVEL,126,-1.0),A,grid,trr,cashr,splits=splits)
    # H1: HY relative rule
    if "hy" in A:
        run_variant("H1 HY level -> regime-aware relative",hy_relative(df,A),A,grid,trr,cashr,splits=splits)
        run_variant("H1+H2 (relative HY + cap126)",cap_duration(hy_relative(df,A),LEVEL,126,0.0),A,grid,trr,cashr,splits=splits)
    # H3: drop weak indicators (from A1/A2 evidence): reserves, rrp, tga, netliq, sofr_iorb, srf
    DROP=[k for k in ["reserves","rrp","tga","netliq","srf"] if k in df.columns]
    if DROP: run_variant("H3 drop plumbing quantity/srf inds",df.drop(columns=DROP),A,grid,trr,cashr,splits=splits)
    # H4: reweight blocks toward change-based/regime
    run_variant("H4 weights plumb15 credit20 market20 macro20 regime25",df,A,grid,trr,cashr,W={"plumb":15,"credit":20,"market":20,"macro":20,"regime":25},splits=splits)
    run_variant("H4b equal block weights",df,A,grid,trr,cashr,W={"plumb":20,"credit":20,"market":20,"macro":20,"regime":20},splits=splits)
    # H5: trend re-entry floor
    run_variant("H5 re-entry floor 65% when >50DMA & rising",df,A,grid,trr,cashr,post=lambda e:reentry_floor(e,grid,0.65,"50dma"),splits=splits)
    run_variant("H5b re-entry floor 65% when >200DMA",df,A,grid,trr,cashr,post=lambda e:reentry_floor(e,grid,0.65,"200dma"),splits=splits)
    run_variant("H5c floor 85% when >200DMA",df,A,grid,trr,cashr,post=lambda e:reentry_floor(e,grid,0.85,"200dma"),splits=splits)
    # H6: trend cap (never above 65% when below 200DMA) — the symmetric rule
    def trend_cap(e):
        p=spx.reindex(grid).ffill(); below=(p<p.rolling(200).mean()).shift(1).fillna(False); e=e.copy(); e[below]=np.minimum(e[below],0.65); return e
    run_variant("H6 cap 65% when <200DMA",df,A,grid,trr,cashr,post=trend_cap,splits=splits)
    run_variant("H5b+H6 trend floor & cap",df,A,grid,trr,cashr,post=lambda e:trend_cap(reentry_floor(e,grid,0.65,"200dma")),splits=splits)
    # combos
    run_variant("COMBO H2(126)+H5b",cap_duration(df,LEVEL,126,0.0),A,grid,trr,cashr,post=lambda e:reentry_floor(e,grid,0.65,"200dma"),splits=splits)
    if "hy" in A:
        run_variant("COMBO H1+H2(126)+H5b+H6",cap_duration(hy_relative(df,A),LEVEL,126,0.0),A,grid,trr,cashr,post=lambda e:trend_cap(reentry_floor(e,grid,0.65,"200dma")),splits=splits)
    # H7: drawdown guard — do not stay below 65% when price is already >20% under its 252d high (late-phase)
    def dd_guard(e, thr=0.20, floor=0.65):
        p=spx.reindex(grid).ffill(); dd=(p/p.rolling(252).max()-1).shift(1); e=e.copy(); m=(dd<-thr).fillna(False); e[m]=np.maximum(e[m],floor); return e
    run_variant("H7 floor 65% when drawdown >20% (late phase)",df,A,grid,trr,cashr,post=dd_guard,splits=splits)
    run_variant("H7b floor 65% when dd>25%",df,A,grid,trr,cashr,post=lambda e:dd_guard(e,0.25,0.65),splits=splits)
    # H8: rung percentages (ladder machine unchanged)
    import harness as HZ
    for nm,pct in [("H8 rungs 100/100/85/50/0",{4:1.0,3:1.0,2:0.85,1:0.5,0:0.0}),("H8b rungs 100/100/65/35/0",{4:1.0,3:1.0,2:0.65,1:0.35,0:0.0}),("H8c rungs 100/85/65/50/0",{4:1.0,3:0.85,2:0.65,1:0.5,0:0.0}),("H8d rungs 100/100/100/50/0",{4:1.0,3:1.0,2:1.0,1:0.5,0:0.0})]:
        old=dict(HZ.RUNG_PCT); HZ.RUNG_PCT.clear(); HZ.RUNG_PCT.update(pct)
        try: run_variant(nm,df,A,grid,trr,cashr,splits=splits)
        finally: HZ.RUNG_PCT.clear(); HZ.RUNG_PCT.update(old)
    # H9: drop VIX level (keep term structure)
    if "vix" in df.columns: run_variant("H9 drop VIX level",df.drop(columns=["vix"]),A,grid,trr,cashr,splits=splits)
    # COMBO: H8 rungs + H5b re-entry + H7 guard
    old=dict(HZ.RUNG_PCT); HZ.RUNG_PCT.clear(); HZ.RUNG_PCT.update({4:1.0,3:1.0,2:0.85,1:0.5,0:0.0})
    try:
        run_variant("COMBO H8+H5b+H7",df,A,grid,trr,cashr,post=lambda e:dd_guard(reentry_floor(e,grid,0.65,"200dma")),splits=splits)
        run_variant("COMBO H8+H5b+H7+H9",df.drop(columns=[c for c in ["vix"] if c in df.columns]),A,grid,trr,cashr,post=lambda e:dd_guard(reentry_floor(e,grid,0.65,"200dma")),splits=splits)
        run_variant("COMBO H8+H7",df,A,grid,trr,cashr,post=dd_guard,splits=splits)
    finally: HZ.RUNG_PCT.clear(); HZ.RUNG_PCT.update(old)
    # no gate
    run_variant("no lead gate",df,A,grid,trr,cashr,splits=splits,gate=(-999,999))
    return df,A,grid

block("2003-2026 full panel","2003-01-01",d)

# long-history core with proxies
baa=L.fred("BAA10Y"); hy_full=d["BAMLH0A0HYM2"].s; ig_full=d["BAMLC0A0CM"].s
common=baa.index.intersection(hy_full.index)
bh=np.polyfit(baa.reindex(common),hy_full.reindex(common),1); bi=np.polyfit(baa.reindex(common),ig_full.reindex(common),1)
hy_ext=pd.concat([(bh[0]*baa+bh[1])[baa.index<hy_full.index[0]],hy_full]).sort_index()
ig_ext=pd.concat([(bi[0]*baa+bi[1])[baa.index<ig_full.index[0]],ig_full]).sort_index()
dx_b=d["DTWEXBGS"].s; dx_m=L.fred("DTWEXM"); j=dx_b.index[0]; scale=dx_b.iloc[0]/dx_m.asof(j)
dx_ext=pd.concat([(dx_m[dx_m.index<j]*scale),dx_b]).sort_index()
d2=dict(d); d2["BAMLH0A0HYM2"]=E.D(hy_ext,1); d2["BAMLC0A0CM"]=E.D(ig_ext,1); d2["DTWEXBGS"]=E.D(dx_ext,4); d2["BTC"]=None
CORE=["spx","spx_mom","vix","hy","hy_mom","ig","sloos","nfci","ratevol","payrolls","sahm","claims","curve","jpy","oil","dxy","cny","goldreal"]
block("1990-2026 CORE (proxy credit)","1990-01-01",d2,core=CORE)
