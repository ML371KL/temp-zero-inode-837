# -*- coding: utf-8 -*-
"""A9: should the change-based VIX be classified 'lead' (goes into the gate) or stay 'coin'? + per-year attribution of P1."""
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
def run(name,df,A,grid,trr,cashr,splits):
    sig=mk_sig(df,A,grid); e,rg=ladder_machine(sig); r,ee=simulate(e,trr,cashr,cost_bps=10)
    s=f"{name:34}"
    for lo,hi in splits:
        rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index)); s+=f" | Sh {m['sharpe']:.3f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
    print(s); return r,ee,sig
grid=spx.loc["2003-01-01":].index; trr=tr.pct_change().reindex(grid).fillna(0.0); cashr=cash.reindex(grid).ffill().fillna(0.0)
df,A=E.build_scores(d,grid); splits=[(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)]
r0,e0,s0=run("BASELINE",df,A,grid,trr,cashr,splits)
r1,e1,s1=run("P1 vix=coin (as now)",vix_mom(df,A),A,grid,trr,cashr,splits)
E.FAM["vix"]=("market","vix",True)
r2,e2,s2=run("P1 vix=lead (enters gate)",vix_mom(df,A),A,grid,trr,cashr,splits)
E.FAM["vix"]=("market","vix",False)
print("\nper-year cumulative excess return P1(coin) minus BASELINE, and Sharpe by year:")
ex=(np.log1p(r1)-np.log1p(r0)).groupby(r1.index.year).sum()*100
shb=r0.groupby(r0.index.year).apply(lambda x:(x-cashr.reindex(x.index)).mean()*252/(x.std()*np.sqrt(252)))
shp=r1.groupby(r1.index.year).apply(lambda x:(x-cashr.reindex(x.index)).mean()*252/(x.std()*np.sqrt(252)))
print(pd.DataFrame({"excess_pp":ex.round(2),"Sh_base":shb.round(2),"Sh_P1":shp.round(2),"E_base":e0.groupby(e0.index.year).mean().round(2),"E_P1":e1.groupby(e1.index.year).mean().round(2)}).to_string())
print("\nVIX score (P1) on key dates vs level score (baseline):")
for dt in ["2008-10-10","2008-12-31","2009-04-01","2020-03-16","2020-04-30","2022-06-15","2024-08-05","2025-04-08","2025-05-15","2026-09-01"]:
    t=pd.Timestamp(dt)
    if t in grid: print(f"  {dt}: level-score {df.loc[t,'vix']:+.0f}  change-score {vix_mom(df,A).loc[t,'vix']:+.0f}  VIX {A.loc[t,'vix']:.1f}  composite base {s0.loc[t,'composite']:+.1f} P1 {s1.loc[t,'composite']:+.1f}")
print("\nlead score today baseline vs P1(lead):",round(s0['lead'].iloc[-1],1),round(s2['lead'].iloc[-1],1))
