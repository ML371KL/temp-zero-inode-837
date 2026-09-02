# -*- coding: utf-8 -*-
"""A10: 'prune' package — move indicators with no forward information (IC≈0 or wrong sign AND removal helps both halves)
to informational status: netliq, tga, reserves, rrp, goldreal, stagf, dxy, cny. Test alone and with P1, both windows."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, metrics
d=L.load_all(); spx=d["SPX"].s; tr=d["SP500TR"].s; cash=d["DTB3"].s/100/252
def hard_market(A, grid):
    hy=A.get("hy",pd.Series(np.nan,index=grid)); hymom=A.get("hy_mom",pd.Series(np.nan,index=grid))
    vix=A.get("vix",pd.Series(np.nan,index=grid)); rvol=A.get("ratevol",pd.Series(0.0,index=grid)); jpyu=A.get("jpy_unwind",pd.Series(0.0,index=grid))
    return (((hy>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vix>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))
def mk_sig(df,A,grid):
    out=E.composite(df,A); HM=hard_market(A,grid); f=out["fund_fired"].astype(bool)
    out["fund"]=f; out["override"]=(f&(HM>=2)).astype(bool); out["hardMarket"]=HM; return out
def vix_mom(df,A,win=21,hi=10,mid=5,lo=-5):
    df=df.copy(); v=A["vix"]; ch=v-v.shift(win)
    sc=pd.Series(np.select([ch>hi,ch>mid,ch>lo],[-2,-1,0],1),index=df.index,dtype=float); sc[ch.isna()|v.isna()]=np.nan; df["vix"]=sc; return df
def sh(x,c): return (x-c).mean()*252/(x.std()*np.sqrt(252))
def paired_boot(rA,rB,cashr,nb=2000,bl=63,seed=11):
    a=rA.values; b=rB.values; c=cashr.reindex(rA.index).values; n=len(a); rng=np.random.default_rng(seed); nblk=int(np.ceil(n/bl)); diffs=[]
    obs=sh(a,c)-sh(b,c)
    for _ in range(nb):
        st=rng.integers(0,n-bl,nblk); idx=np.concatenate([np.arange(s,s+bl) for s in st]); idx=idx[:n]
        diffs.append(sh(a[idx],c[idx])-sh(b[idx],c[idx]))
    diffs=np.array(diffs); return obs,(diffs<=0).mean()
def run(name,df,A,grid,trr,cashr,splits):
    sig=mk_sig(df,A,grid); e,rg=ladder_machine(sig); r,ee=simulate(e,trr,cashr,cost_bps=10)
    s=f"{name:36}"
    for lo,hi in splits:
        rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index)); s+=f" | Sh {m['sharpe']:.3f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
    print(s); return r,ee
PRUNE=["netliq","tga","reserves","rrp","goldreal","stagf","dxy","cny"]
def block(title,start,d_,core,splits):
    grid=spx.loc[start:].index; trr=tr.pct_change().reindex(grid).fillna(0.0); cashr=cash.reindex(grid).ffill().fillna(0.0)
    df,A=E.build_scores(d_,grid)
    if core: df=df[[k for k in core if k in df.columns]]
    print(f"\n=== {title} ===")
    r0,_=run("BASELINE",df,A,grid,trr,cashr,splits)
    dfp=df.drop(columns=[c for c in PRUNE if c in df.columns])
    rp,_=run("PRUNE (8 inds -> info)",dfp,A,grid,trr,cashr,splits)
    r1,_=run("P1 (VIX change)",vix_mom(df,A),A,grid,trr,cashr,splits)
    r1p,_=run("P1 + PRUNE",vix_mom(dfp,A),A,grid,trr,cashr,splits)
    for nm,rr in [("PRUNE",rp),("P1+PRUNE vs P1",r1p)]:
        base=r0 if nm=="PRUNE" else r1
        for lo,hi in splits:
            obs,p=paired_boot(rr.loc[lo:hi],base.loc[lo:hi],cashr); print(f"   {nm:16} {str(lo)[:4] if lo else 'full':>5}..{str(hi)[:4] if hi else 'end':<4}: dSh {obs:+.3f} P(<=0)={p:.3f}")
    # smaller prune sets
    for sub in (["netliq","tga","reserves","rrp"],["goldreal","stagf","dxy","cny"]):
        dfs=df.drop(columns=[c for c in sub if c in df.columns]); run("drop "+",".join(sub),dfs,A,grid,trr,cashr,splits)
block("2003-2026 full panel","2003-01-01",d,None,[(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)])
baa=L.fred("BAA10Y"); hy_full=d["BAMLH0A0HYM2"].s
common=baa.index.intersection(hy_full.index); bh=np.polyfit(baa.reindex(common),hy_full.reindex(common),1)
hy_ext=pd.concat([(bh[0]*baa+bh[1])[baa.index<hy_full.index[0]],hy_full]).sort_index()
dx_b=d["DTWEXBGS"].s; dx_m=L.fred("DTWEXM"); j=dx_b.index[0]; scale=dx_b.iloc[0]/dx_m.asof(j); dx_ext=pd.concat([(dx_m[dx_m.index<j]*scale),dx_b]).sort_index()
d2=dict(d); d2["BAMLH0A0HYM2"]=E.D(hy_ext,1); d2["DTWEXBGS"]=E.D(dx_ext,4); d2["BTC"]=None
CORE=["spx","spx_mom","vix","hy","hy_mom","ig","sloos","nfci","ratevol","payrolls","sahm","claims","curve","jpy","oil","dxy","cny","goldreal"]
block("1990-2026 CORE","1990-01-01",d2,CORE,[(None,None),("1990-01-01","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01",None)])
