# -*- coding: utf-8 -*-
"""A8: final package validation. Candidate = VIX level -> VIX 21d change (zones a priori: >+10:-2, +5..10:-1, -5..+5:0, <-5:+1),
optionally + trend re-entry floor (65% when SPX>200DMA). Parameter jitter (windows/thresholds), paired bootstrap,
crisis attribution, rolling win-rates, turnover; 2003-2026 (halves) and 1990-2026 core (sub-windows)."""
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
def vix_hybrid(df,A):
    """level keeps its calm zones (<13:0, 13-20:+1, 20-26:0) but stress zones come from change: -1 if 21d chg>+5, -2 if >+10; >26 & falling -> 0"""
    df=df.copy(); v=A["vix"]; ch=v-v.shift(21)
    sc=pd.Series(np.select([v<13,v<20,ch>10,ch>5,v<26],[0,1,-2,-1,0],0),index=df.index,dtype=float); sc[v.isna()|ch.isna()]=np.nan; df["vix"]=sc; return df
def reentry(e,grid,floor=0.65):
    p=spx.reindex(grid).ffill(); cond=(p>p.rolling(200).mean()).shift(1).fillna(False); e=e.copy(); e[cond]=np.maximum(e[cond],floor); return e
def sh(x,c): return (x-c).mean()*252/(x.std()*np.sqrt(252))
def paired_boot(rA,rB,cashr,nb=3000,bl=63,seed=11):
    a=rA.values; b=rB.values; c=cashr.reindex(rA.index).values; n=len(a); rng=np.random.default_rng(seed); nblk=int(np.ceil(n/bl)); diffs=[]
    obs=sh(a,c)-sh(b,c)
    for _ in range(nb):
        st=rng.integers(0,n-bl,nblk); idx=np.concatenate([np.arange(s,s+bl) for s in st])[:n]
        diffs.append(sh(a[idx],c[idx])-sh(b[idx],c[idx]))
    diffs=np.array(diffs); return obs,(diffs<=0).mean(),np.percentile(diffs,[2.5,97.5])

def run(name,df,A,grid,trr,cashr,splits,post=None,quiet=False):
    sig=mk_sig(df,A,grid); e,rg=ladder_machine(sig)
    if post: e=post(e)
    r,ee=simulate(e,trr,cashr,cost_bps=10)
    if not quiet:
        s=f"{name:40}"
        for lo,hi in splits:
            rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index)); s+=f" | Sh {m['sharpe']:.3f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
        sw=int((ee.diff().abs()>1e-9).sum())/(len(ee)/252); s+=f" | sw/yr {sw:.1f}"; print(s)
    return r,ee,rg

def block(title,start,d_,core,splits):
    grid=spx.loc[start:].index; trr=tr.pct_change().reindex(grid).fillna(0.0); cashr=cash.reindex(grid).ffill().fillna(0.0)
    df,A=E.build_scores(d_,grid)
    if core: df=df[[k for k in core if k in df.columns]]
    print(f"\n=== {title}: {grid[0].date()}..{grid[-1].date()} | "+" | ".join(f"{a or 'start'}..{b or 'end'}" for a,b in splits)+" ===")
    r0,e0,g0=run("BASELINE (live logic)",df,A,grid,trr,cashr,splits)
    rbh,_=simulate(pd.Series(1.0,index=grid),trr,cashr,cost_bps=0)
    print("--- (1) VIX change: parameter jitter (a-priori choice = win 21, thresholds +10/+5/-5) ---")
    res={}
    for win in (15,21,30):
        for hi,mid,lo in [(10,5,-5),(8,4,-4),(12,6,-6),(10,5,-3),(10,3,-5)]:
            nm=f"VIXchg win{win} thr {hi}/{mid}/{lo}"
            res[nm]=run(nm,vix_mom(df,A,win,hi,mid,lo),A,grid,trr,cashr,splits)
    r1,e1,g1=run("VIX hybrid (calm zones by level, stress by change)",vix_hybrid(df,A),A,grid,trr,cashr,splits)
    print("--- (2) packages ---")
    rV,eV,gV=run("P1 = VIX change (21/10/5/-5)",vix_mom(df,A),A,grid,trr,cashr,splits)
    rVR,eVR,gVR=run("P2 = P1 + re-entry floor 65% (>200DMA)",vix_mom(df,A),A,grid,trr,cashr,splits,post=lambda e:reentry(e,grid,0.65))
    rR,eR,gR=run("re-entry floor only",df,A,grid,trr,cashr,splits,post=lambda e:reentry(e,grid,0.65))
    print("--- (3) paired block-bootstrap (63d blocks, 3000 draws): Sharpe diff vs BASELINE ---")
    for nm,rr in [("P1",rV),("P2",rVR),("re-entry only",rR),("VIX hybrid",r1)]:
        for lo,hi in splits:
            obs,p,ci=paired_boot(rr.loc[lo:hi],r0.loc[lo:hi],cashr)
            print(f"  {nm:14} {str(lo)[:4] if lo else 'full':>5}..{str(hi)[:4] if hi else 'end':<4}: dSh {obs:+.3f}  P(<=0)={p:.3f}  CI [{ci[0]:+.3f},{ci[1]:+.3f}]")
    print("--- (4) crisis attribution & deep-drawdown exposure ---")
    crash=pd.Series(False,index=grid)
    for a_,b_ in [("2000-03-24","2002-10-09"),("2008-09-01","2009-06-30"),("2020-02-19","2020-06-30"),("2022-01-03","2022-10-12")]: crash.loc[a_:b_]=True
    m=~crash; c=cashr
    print(f"  ex-bear-markets Sharpe: BASELINE {sh(r0[m],c[m]):.3f}  P1 {sh(rV[m],c[m]):.3f}  P2 {sh(rVR[m],c[m]):.3f}  BH {sh(rbh[m],c[m]):.3f}")
    print(f"  bear-market days only:  BASELINE {sh(r0[~m],c[~m]):.3f}  P1 {sh(rV[~m],c[~m]):.3f}  P2 {sh(rVR[~m],c[~m]):.3f}  BH {sh(rbh[~m],c[~m]):.3f}")
    p=spx.reindex(grid).ffill(); dd=(p/p.rolling(252).max()-1); deep=dd<-0.2
    print(f"  avg exposure while >20% below 1y high: BASELINE {e0[deep].mean():.2f}  P1 {eV[deep].mean():.2f}  P2 {eVR[deep].mean():.2f}")
    # bear-market returns table
    for a_,b_ in [("2000-03-24","2002-10-09"),("2007-10-09","2009-03-09"),("2020-02-19","2020-03-23"),("2022-01-03","2022-10-12"),("2025-02-19","2025-04-08")]:
        if pd.Timestamp(a_)<grid[0]: continue
        seg=slice(a_,b_)
        cum=lambda r:( (1+r.loc[seg]).prod()-1)*100
        print(f"  {a_}..{b_}: BH {cum(rbh):+.1f}%  BASELINE {cum(r0):+.1f}% (E {e0.loc[seg].mean():.2f})  P1 {cum(rV):+.1f}% (E {eV.loc[seg].mean():.2f})  P2 {cum(rVR):+.1f}% (E {eVR.loc[seg].mean():.2f})")
    print("--- (5) rolling 3y windows: share where variant beats BASELINE on Sharpe / on return ---")
    for nm,rr in [("P1",rV),("P2",rVR)]:
        w=756; eqA=(1+rr).cumprod(); eqB=(1+r0).cumprod()
        ra=eqA.pct_change(w); rb=eqB.pct_change(w); both=pd.concat([ra,rb],axis=1).dropna()
        shA=rr.rolling(w).apply(lambda x:(x.mean()*252)/(x.std()*np.sqrt(252)),raw=True); shB=r0.rolling(w).apply(lambda x:(x.mean()*252)/(x.std()*np.sqrt(252)),raw=True)
        bs=pd.concat([shA,shB],axis=1).dropna()
        print(f"  {nm}: beats on return {(both.iloc[:,0]>both.iloc[:,1]).mean()*100:.0f}% of 3y windows | on Sharpe {(bs.iloc[:,0]>bs.iloc[:,1]).mean()*100:.0f}%")
    # verdict/rung distribution changes
    print("--- (6) rung share BASELINE vs P1 ---")
    for nm,g in [("BASELINE",g0),("P1",gV),("P2",gVR)]:
        print(f"  {nm:9}", {int(k):round(v*100,1) for k,v in g.value_counts(normalize=True).sort_index().items()})
    # save series for report
    os.makedirs("out",exist_ok=True)
    pd.DataFrame({"bh":rbh,"base":r0,"p1":rV,"p2":rVR,"e_base":e0,"e_p1":eV,"e_p2":eVR}).to_csv(f"out/a8_series_{start[:4]}.csv")
    return df,A,grid

block("2003-2026 full panel","2003-01-01",d,None,[(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)])
baa=L.fred("BAA10Y"); hy_full=d["BAMLH0A0HYM2"].s
common=baa.index.intersection(hy_full.index); bh=np.polyfit(baa.reindex(common),hy_full.reindex(common),1)
hy_ext=pd.concat([(bh[0]*baa+bh[1])[baa.index<hy_full.index[0]],hy_full]).sort_index()
dx_b=d["DTWEXBGS"].s; dx_m=L.fred("DTWEXM"); j=dx_b.index[0]; scale=dx_b.iloc[0]/dx_m.asof(j); dx_ext=pd.concat([(dx_m[dx_m.index<j]*scale),dx_b]).sort_index()
d2=dict(d); d2["BAMLH0A0HYM2"]=E.D(hy_ext,1); d2["DTWEXBGS"]=E.D(dx_ext,4); d2["BTC"]=None
CORE=["spx","spx_mom","vix","hy","hy_mom","ig","sloos","nfci","ratevol","payrolls","sahm","claims","curve","jpy","oil","dxy","cny","goldreal"]
block("1990-2026 CORE","1990-01-01",d2,CORE,[(None,None),("1990-01-01","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01",None)])
