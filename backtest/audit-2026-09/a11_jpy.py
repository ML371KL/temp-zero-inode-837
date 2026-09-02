# -*- coding: utf-8 -*-
"""A11 (from rev1): the USD/JPY card uses absolute thresholds 152/158 calibrated to 2024-26 -> score -2 on 94% of 2003-2023 days,
a permanent -8pt offset on the lead scale (halves the BUY gate). Test: change-only rule (Δ30 < -8: -2, < -4: -1, else 0),
alone and combined with P1 (VIX change). Both windows."""
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
def jpy_rel(df,grid):
    j=d["DEXJPUS"].s; prev=j.reindex(j.index-pd.Timedelta(days=30),method="ffill"); prev.index=j.index; ch=j-prev
    sc=pd.Series(np.select([ch<-8,ch<-4],[-2,-1],0),index=j.index,dtype=float); sc[ch.isna()]=np.nan
    sc=pd.Series(sc.values,index=sc.index+pd.Timedelta(days=1)).sort_index(); sc=sc[~sc.index.duplicated(keep="last")]
    df=df.copy(); df["jpy"]=sc.reindex(sc.index.union(grid)).ffill().reindex(grid); return df
def sh(x,c): return (x-c).mean()*252/(x.std()*np.sqrt(252))
def paired_boot(rA,rB,cashr,nb=2000,bl=63,seed=11):
    a=rA.values; b=rB.values; c=cashr.reindex(rA.index).values; n=len(a); rng=np.random.default_rng(seed); nblk=int(np.ceil(n/bl)); diffs=[]
    obs=sh(a,c)-sh(b,c)
    for _ in range(nb):
        st=rng.integers(0,n-bl,nblk); idx=np.concatenate([np.arange(s,s+bl) for s in st])[:n]
        diffs.append(sh(a[idx],c[idx])-sh(b[idx],c[idx]))
    diffs=np.array(diffs); return obs,(diffs<=0).mean()
def run(name,df,A,grid,trr,cashr,splits):
    sig=mk_sig(df,A,grid); e,rg=ladder_machine(sig); r,ee=simulate(e,trr,cashr,cost_bps=10)
    s=f"{name:36}"
    for lo,hi in splits:
        rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index)); s+=f" | Sh {m['sharpe']:.3f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
    v=E.verdict_series(sig); s+=f" | BUY {(v=='BUY').mean()*100:.1f}% lead>=10 {(sig['lead']>=10).mean()*100:.0f}%"
    print(s); return r
def block(title,start,d_,core,splits):
    grid=spx.loc[start:].index; trr=tr.pct_change().reindex(grid).fillna(0.0); cashr=cash.reindex(grid).ffill().fillna(0.0)
    df,A=E.build_scores(d_,grid)
    if core: df=df[[k for k in core if k in df.columns]]
    print(f"\n=== {title} ===")
    print("jpy score share (as built):", df["jpy"].value_counts(normalize=True).round(3).to_dict())
    r0=run("BASELINE",df,A,grid,trr,cashr,splits)
    rj=run("JPY change-only (rel. thresholds)",jpy_rel(df,grid),A,grid,trr,cashr,splits)
    r1=run("P1 (VIX change)",vix_mom(df,A),A,grid,trr,cashr,splits)
    r1j=run("P1 + JPY change-only",jpy_rel(vix_mom(df,A),grid),A,grid,trr,cashr,splits)
    rd=run("JPY dropped",df.drop(columns=["jpy"]),A,grid,trr,cashr,splits)
    for nm,rr,base in [("JPYrel vs BASE",rj,r0),("P1+JPYrel vs P1",r1j,r1),("JPY dropped vs BASE",rd,r0)]:
        for lo,hi in splits:
            obs,p=paired_boot(rr.loc[lo:hi],base.loc[lo:hi],cashr); print(f"   {nm:20} {str(lo)[:4] if lo else 'full':>5}..{str(hi)[:4] if hi else 'end':<4}: dSh {obs:+.3f} P(<=0)={p:.3f}")
block("2003-2026 full panel","2003-01-01",d,None,[(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)])
baa=L.fred("BAA10Y"); hy_full=d["BAMLH0A0HYM2"].s
common=baa.index.intersection(hy_full.index); bh=np.polyfit(baa.reindex(common),hy_full.reindex(common),1)
hy_ext=pd.concat([(bh[0]*baa+bh[1])[baa.index<hy_full.index[0]],hy_full]).sort_index()
dx_b=d["DTWEXBGS"].s; dx_m=L.fred("DTWEXM"); j=dx_b.index[0]; scale=dx_b.iloc[0]/dx_m.asof(j); dx_ext=pd.concat([(dx_m[dx_m.index<j]*scale),dx_b]).sort_index()
d2=dict(d); d2["BAMLH0A0HYM2"]=E.D(hy_ext,1); d2["DTWEXBGS"]=E.D(dx_ext,4); d2["BTC"]=None
CORE=["spx","spx_mom","vix","hy","hy_mom","ig","sloos","nfci","ratevol","payrolls","sahm","claims","curve","jpy","oil","dxy","cny","goldreal"]
block("1990-2026 CORE","1990-01-01",d2,CORE,[(None,None),("1990-01-01","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01",None)])
