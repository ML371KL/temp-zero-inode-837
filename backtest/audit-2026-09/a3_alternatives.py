# -*- coding: utf-8 -*-
"""A3: (1) simple benchmark rules vs the dashboard ladder on 2003-2026;
(2) long-history core dashboard 1990-2026 with HY proxy (BAA10Y) and DXY splice (DTWEXM);
(3) structural alternatives: binary protect, two-layer (slow regime x fast shock), vol-target."""
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

def mk_sig(df,A,grid):
    out=E.composite(df,A); HM=hard_market(A,grid); f=out["fund_fired"].astype(bool)
    out["fund"]=f; out["override"]=(f&(HM>=2)).astype(bool); out["hardMarket"]=HM; return out

def summarize(name, e, grid, trr, cashr, cost=10, splits=None):
    r,ee=simulate(e,trr,cashr,cost_bps=cost)
    s=f"{name:40}"
    sp=splits or [(None,None)]
    for lo,hi in sp:
        rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index))
        s+=f" | Sh {m['sharpe']:.2f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
    return s, r

# ---------------- (1) benchmarks 2003-2026 ----------------
START="2003-01-01"; grid=spx.loc[START:].index
trr=tr.pct_change().reindex(grid).fillna(0.0); cashr=cash.reindex(grid).ffill().fillna(0.0)
df,A=E.build_scores(d,grid); sig=mk_sig(df,A,grid)
e_dash,rung=ladder_machine(sig)
splits=[(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)]
print("=== A3.1 Benchmarks vs dashboard, 2003-2026 (cols: full | 2003-14 | 2015-26) ===")
lines=[]
lines.append(summarize("DASH ladder (as built)",e_dash,grid,trr,cashr,10,splits))
lines.append(summarize("Buy&Hold",pd.Series(1.0,index=grid),grid,trr,cashr,0,splits))
lines.append(summarize("Const matched exposure",pd.Series(e_dash.mean(),index=grid),grid,trr,cashr,0,splits))
sma200=spx.rolling(200).mean(); above=(spx>sma200).astype(float).reindex(grid).ffill()
lines.append(summarize("200DMA binary (1/0)",above,grid,trr,cashr,10,splits))
lines.append(summarize("200DMA 1/0.35 (floor 35%)",(0.35+0.65*above),grid,trr,cashr,10,splits))
mom12=(spx/spx.shift(252)-1); m12=(mom12>0).astype(float).reindex(grid).ffill()
lines.append(summarize("12m momentum binary",m12,grid,trr,cashr,10,splits))
hy=d["BAMLH0A0HYM2"].s; hyl=pd.Series(hy.values,index=hy.index+pd.Timedelta(days=1))
hy6=hyl.rolling(126).mean(); credit_ok=(hyl<hy6).astype(float).reindex(grid).ffill()
lines.append(summarize("HY < 6m mean binary",credit_ok,grid,trr,cashr,10,splits))
prev30=hyl.reindex(hyl.index-pd.Timedelta(days=30),method="ffill"); prev30.index=hyl.index
hy_mom30=(hyl-prev30)*100
credit_calm=(hy_mom30<25).astype(float).reindex(grid).ffill()
lines.append(summarize("HY 30d momentum < +25bp binary",credit_calm,grid,trr,cashr,10,splits))
vix=d["VIXCLS"].s; vixl=pd.Series(vix.values,index=vix.index+pd.Timedelta(days=1)); vcalm=(vixl<25).astype(float).reindex(grid).ffill()
lines.append(summarize("VIX < 25 binary",vcalm,grid,trr,cashr,10,splits))
ens=(above+credit_ok+vcalm)/3
lines.append(summarize("Ensemble3 (trend,credit,vix) linear",(ens),grid,trr,cashr,10,splits))
lines.append(summarize("Ensemble3 floor 35%",(0.35+0.65*ens),grid,trr,cashr,10,splits))
ens2=(above+credit_ok)/2
lines.append(summarize("Ensemble2 (trend,credit) 1/.5/0",ens2,grid,trr,cashr,10,splits))
rv=np.log(spx).diff().rolling(21).std()*np.sqrt(252); vt=(0.12/rv).clip(upper=1.0).reindex(grid).ffill()
lines.append(summarize("Vol-target 12% cap 1",vt,grid,trr,cashr,10,splits))
lines.append(summarize("Trend x Vol-target",(above*vt).clip(upper=1.0),grid,trr,cashr,10,splits))
lines.append(summarize("DASH x Vol-target (min)",np.minimum(e_dash,vt),grid,trr,cashr,10,splits))
lines.append(summarize("DASH ensemble w/ trend (avg)",(e_dash+above)/2,grid,trr,cashr,10,splits))
for s,_ in lines: print(s)

# ---------------- (2) structural alternatives on the dashboard signal ----------------
print("\n=== A3.2 Structural alternatives using the dashboard composite ===")
c=sig["composite"]; lead=sig["lead"]; cov=sig["cover"]
bp=pd.Series(np.where((c<-30)&(cov>=0.6),0.0,1.0),index=grid)
print(summarize("Binary: 100% / 0% at composite<-30",bp,grid,trr,cashr,10,splits)[0])
bp2=pd.Series(np.where((c<-10)&(cov>=0.6),0.35,1.0),index=grid)
print(summarize("Binary: 100% / 35% at composite<-10",bp2,grid,trr,cashr,10,splits)[0])
tri=pd.Series(np.select([(c<-30)&(cov>=.6),(c<-10)&(cov>=.6)],[0.0,0.5],1.0),index=grid)
print(summarize("3-step: 1 / .5 (<-10) / 0 (<-30)",tri,grid,trr,cashr,10,splits)[0])
lin=((c+30)/60).clip(0,1).where(cov>=0.6,0.65)
print(summarize("Linear: expo=(comp+30)/60 clipped",lin,grid,trr,cashr,10,splits)[0])
e_mod=e_dash.copy()
e_mod[(rung.isin([2,3]))&(lead>10)]=1.0
e_mod[(rung.isin([2,3]))&(lead<-10)]=0.5
print(summarize("DASH ladder + lead modulation",e_mod,grid,trr,cashr,10,splits)[0])
W=E.W; FAM=E.FAM
def block_score(dfx,b):
    ks=[k for k in dfx.columns if FAM[k][0]==b]; fams={}
    for k in ks: fams.setdefault(FAM[k][1],[]).append(k)
    return pd.concat([dfx[x].mean(axis=1) for x in fams.values()],axis=1).mean(axis=1)/2*100
B={b:block_score(df,b) for b in W}
slow=(B["credit"]+B["macro"])/2; fast=B["market"]
two=pd.Series(1.0,index=grid)
two[(slow<-10)]=0.65; two[(slow<-30)]=0.35
two[(fast<-30)]=two[(fast<-30)]*0.5
two[sig["fund"]]=two[sig["fund"]]*0.5
print(summarize("Two-layer slow(credit+macro)/fast(market)",two,grid,trr,cashr,10,splits)[0])

# ---------------- (3) long history 1990-2026 core ----------------
print("\n=== A3.3 Long-history core dashboard 1990-2026 (HY/IG proxy from BAA10Y pre-2000; DXY spliced with DTWEXM) ===")
baa=L.fred("BAA10Y"); hy_full=d["BAMLH0A0HYM2"].s; ig_full=d["BAMLC0A0CM"].s
common=baa.index.intersection(hy_full.index)
bh=np.polyfit(baa.reindex(common),hy_full.reindex(common),1); bi=np.polyfit(baa.reindex(common),ig_full.reindex(common),1)
print(f"proxy fits on {len(common)} days: HY%={bh[0]:.2f}*BAA10Y{bh[1]:+.2f}  IG%={bi[0]:.2f}*BAA10Y{bi[1]:+.2f}  corr HY {np.corrcoef(baa.reindex(common),hy_full.reindex(common))[0,1]:.2f}")
hy_proxy=(bh[0]*baa+bh[1]); ig_proxy=(bi[0]*baa+bi[1])
hy_ext=pd.concat([hy_proxy[hy_proxy.index<hy_full.index[0]],hy_full]).sort_index()
ig_ext=pd.concat([ig_proxy[ig_proxy.index<ig_full.index[0]],ig_full]).sort_index()
dx_b=d["DTWEXBGS"].s; dx_m=L.fred("DTWEXM")
j=dx_b.index[0]; scale=dx_b.iloc[0]/dx_m.asof(j)
dx_ext=pd.concat([(dx_m[dx_m.index<j]*scale),dx_b]).sort_index()
d2=dict(d)
d2["BAMLH0A0HYM2"]=E.D(hy_ext,1); d2["BAMLC0A0CM"]=E.D(ig_ext,1); d2["DTWEXBGS"]=E.D(dx_ext,4)
d2["BTC"]=None
gridL=spx.loc["1990-01-01":].index
dfL,AL=E.build_scores(d2,gridL)
CORE=["spx","spx_mom","vix","hy","hy_mom","ig","sloos","nfci","ratevol","payrolls","sahm","claims","curve","jpy","oil","dxy","cny","goldreal"]
dfC=dfL[[k for k in CORE if k in dfL.columns]]
sigL=mk_sig(dfC,AL,gridL)
trrL=tr.pct_change().reindex(gridL).fillna(0.0); cashL=cash.reindex(gridL).ffill().fillna(0.0)
splitsL=[(None,None),("1990-01-01","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01",None)]
print("cols: full 1990-2026 | 1990-2002 | 2003-2014 | 2015-2026 ; core cover>=0.6 share:",round((sigL["cover"]>=0.6).mean(),3))
eL,rL=ladder_machine(sigL)
print(summarize("CORE ladder 1990-2026",eL,gridL,trrL,cashL,10,splitsL)[0])
print(summarize("Buy&Hold",pd.Series(1.0,index=gridL),gridL,trrL,cashL,0,splitsL)[0])
print(summarize("Const matched",pd.Series(eL.mean(),index=gridL),gridL,trrL,cashL,0,splitsL)[0])
aboveL=(spx>spx.rolling(200).mean()).astype(float).reindex(gridL).ffill()
print(summarize("200DMA binary",aboveL,gridL,trrL,cashL,10,splitsL)[0])
hyL=pd.Series(hy_ext.values,index=hy_ext.index+pd.Timedelta(days=1)); cokL=(hyL<hyL.rolling(126).mean()).astype(float).reindex(gridL).ffill()
vixL=pd.Series(d["VIXCLS"].s.values,index=d["VIXCLS"].s.index+pd.Timedelta(days=1)); vcL=(vixL<25).astype(float).reindex(gridL).ffill()
print(summarize("Ensemble3 floor 35%",0.35+0.65*(aboveL+cokL+vcL)/3,gridL,trrL,cashL,10,splitsL)[0])
print(summarize("Ensemble2 (trend,credit)",(aboveL+cokL)/2,gridL,trrL,cashL,10,splitsL)[0])
vL=E.verdict_series(sigL)
trgL=tr.reindex(gridL).ffill(); f3=np.log(trgL.shift(-63)/trgL)-cashL.rolling(63).sum().shift(-63); f12=np.log(trgL.shift(-252)/trgL)-cashL.rolling(252).sum().shift(-252)
print("verdict share 1990-2026:",(vL.value_counts(normalize=True)*100).round(1).to_dict())
for vv in ["PROTECT","REDUCE","HOLD","HOLD+","BUY"]:
    x3=f3[vL==vv].dropna(); x12=f12[vL==vv].dropna()
    if len(x3): print(f"  {vv:8} fwd3m {x3.mean()*4*100:+.1f}%/yr (hit {(x3>0).mean()*100:.0f}%)  fwd12m {x12.mean()*100:+.1f}% (hit {(x12>0).mean()*100:.0f}%)  n={len(x3)}")
os.makedirs("out",exist_ok=True)
pd.DataFrame({"expo":eL,"rung":rL,"composite":sigL["composite"],"lead":sigL["lead"],"cover":sigL["cover"]}).to_csv("out/core_1990.csv")
pd.DataFrame({"expo":e_dash,"rung":rung,"composite":c,"lead":lead,"cover":cov}).to_csv("out/dash_2003.csv")
print("saved out/core_1990.csv out/dash_2003.csv")
