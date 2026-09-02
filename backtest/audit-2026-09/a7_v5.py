# -*- coding: utf-8 -*-
"""A7: (a) VIX handling variants; (b) new-indicator additions (economically pre-specified zones, no tuning);
(c) the candidate package V5 = trend re-entry floor + VIX de-extremized (+ optional rung map),
with paired block-bootstrap significance vs baseline, sub-window robustness, crisis attribution."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
import harness as HZ
from harness import ladder_machine, simulate, metrics

d=L.load_all(); spx=d["SPX"].s; tr=d["SP500TR"].s; cash=d["DTB3"].s/100/252

def F(name):
    try: return L.fred(name)
    except Exception: return None
def Y(name):
    try: return L.yahoo(name)
    except Exception: return None
def lag(s,days): return pd.Series(s.values,index=s.index+pd.Timedelta(days=days)).sort_index()
def ong(s,grid): s=s[~s.index.duplicated(keep="last")]; return s.reindex(s.index.union(grid)).ffill().reindex(grid)
def rel63(a,b):
    r_=np.log(a)-np.log(b.reindex(a.index,method="ffill")); return (r_-r_.shift(63))*100

def hard_market(A, grid):
    hy=A.get("hy",pd.Series(np.nan,index=grid)); hymom=A.get("hy_mom",pd.Series(np.nan,index=grid))
    vix=A.get("vix",pd.Series(np.nan,index=grid)); rvol=A.get("ratevol",pd.Series(0.0,index=grid)); jpyu=A.get("jpy_unwind",pd.Series(0.0,index=grid))
    return (((hy>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vix>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))

def mk_sig(df,A,grid):
    out=E.composite(df,A); HM=hard_market(A,grid); f=out["fund_fired"].astype(bool)
    out["fund"]=f; out["override"]=(f&(HM>=2)).astype(bool); out["hardMarket"]=HM; return out

def vix_variant(df,A,kind):
    df=df.copy(); v=A["vix"]
    if kind=="cap35_0":   # >35 -> 0 (contrarian extreme neutralised), 26-35 stays -1
        sc=pd.Series(np.select([v<13,v<20,v<26,v<35],[0,1,0,-1],0),index=df.index,dtype=float)
    elif kind=="cap35_-1": # >35 -> -1
        sc=pd.Series(np.select([v<13,v<20,v<26,v<35],[0,1,0,-1],-1),index=df.index,dtype=float)
    elif kind=="mom":      # VIX change-based: 30d change in VIX points: >+10 -> -2, +5..10 -> -1, -5..5 -> 0, < -5 -> +1
        ch=v-v.shift(21)
        sc=pd.Series(np.select([ch>10,ch>5,ch>-5],[-2,-1,0],1),index=df.index,dtype=float)
    elif kind=="drop":
        return df.drop(columns=["vix"])
    sc[v.isna()]=np.nan; df["vix"]=sc; return df

def add_indicator(df, name, score, block, family=None, lead=False):
    """register a new indicator in engine FAM (block, family, lead) and add its score column."""
    df=df.copy(); df[name]=score; E.FAM[name]=(block, family or name, lead); return df

def new_scores(grid):
    S={}
    g10=F("DGS10")
    if g10 is not None:
        ch=(g10-g10.shift(63))*100; sp20=(spx/spx.shift(20)-1)*100
        sp=sp20.reindex(ch.index,method="ffill")
        sc=pd.Series(np.select([ch>75,ch>40,ch>-40,(ch<=-40)&(sp>-3)],[-2,-1,0,1],0),index=ch.index,dtype=float); sc[ch.isna()]=np.nan
        S["rateshock"]=(ong(lag(sc.dropna(),1),grid),"macro",True)
    nfl=F("NFCINONFINLEVERAGE")
    if nfl is not None:
        sc=pd.Series(np.select([nfl>1.0,nfl>0.5,nfl>-0.5],[-2,-1,0],1),index=nfl.index,dtype=float)
        S["nfci_lev"]=(ong(lag(sc,5),grid),"credit",True)
    rsp=Y("RSP"); spy=Y("SPY")
    if rsp is not None and spy is not None:
        r=rel63(rsp,spy); sc=pd.Series(np.select([r<-4,r>2],[-1,1],0),index=r.index,dtype=float); sc[r.isna()]=np.nan
        S["breadth_rsp"]=(ong(lag(sc.dropna(),1),grid),"market",True)
    smh=Y("SMH")
    if smh is not None and spy is not None:
        r=rel63(smh,spy); sc=pd.Series(np.select([r<-8,r>5],[-1,1],0),index=r.index,dtype=float); sc[r.isna()]=np.nan
        S["smh_rel"]=(ong(lag(sc.dropna(),1),grid),"market",True)
    hg=Y("HG"); gc=Y("GOLD")
    if hg is not None and gc is not None:
        r=rel63(hg,gc); sc=pd.Series(np.select([r<-8,r>5],[-1,1],0),index=r.index,dtype=float); sc[r.isna()]=np.nan
        S["cu_au"]=(ong(lag(sc.dropna(),1),grid),"regime",True)
    ig=d["BAMLC0A0CM"].s*100; p30=ig.reindex(ig.index-pd.Timedelta(days=30),method="ffill"); p30.index=ig.index; m=ig-p30
    sc=pd.Series(np.select([m>40,m>20,m>-10],[-2,-1,0],1),index=ig.index,dtype=float); sc[m.isna()]=np.nan
    S["ig_mom"]=(ong(lag(sc.dropna(),1),grid),"credit",True)   # family 'ig' set below
    return S

def summarize(name,e,grid,trr,cashr,splits,cost=10):
    r,ee=simulate(e,trr,cashr,cost_bps=cost); s=f"{name:44}"
    for lo,hi in splits:
        rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index)); s+=f" | Sh {m['sharpe']:.2f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
    sw=int((ee.diff().abs()>1e-9).sum())/(len(ee)/252); s+=f" | sw/yr {sw:.1f}"
    print(s); return r,ee

def reentry(e,grid,floor=0.65):
    p=spx.reindex(grid).ffill(); cond=(p>p.rolling(200).mean()).shift(1).fillna(False); e=e.copy(); e[cond]=np.maximum(e[cond],floor); return e

def run(name,df,A,grid,trr,cashr,splits,post=None,rungs=None):
    old=dict(HZ.RUNG_PCT)
    if rungs: HZ.RUNG_PCT.clear(); HZ.RUNG_PCT.update(rungs)
    try:
        sig=mk_sig(df,A,grid); e,_=ladder_machine(sig)
        if post: e=post(e)
        return summarize(name,e,grid,trr,cashr,splits)
    finally: HZ.RUNG_PCT.clear(); HZ.RUNG_PCT.update(old)

def paired_boot(rA,rB,cashr,nb=2000,bl=63,seed=11):
    """P(Sharpe(A)-Sharpe(B)<=0) via moving-block bootstrap on paired daily returns."""
    a=rA.values; b=rB.values; c=cashr.reindex(rA.index).values; n=len(a); rng=np.random.default_rng(seed); nblk=int(np.ceil(n/bl)); diffs=[]
    def sh(x,cc): return (x-cc).mean()*252/(x.std()*np.sqrt(252))
    obs=sh(a,c)-sh(b,c)
    for _ in range(nb):
        st=rng.integers(0,n-bl,nblk); idx=np.concatenate([np.arange(s,s+bl) for s in st])[:n]
        diffs.append(sh(a[idx],c[idx])-sh(b[idx],c[idx]))
    diffs=np.array(diffs); return obs,(diffs<=0).mean(),np.percentile(diffs,[2.5,97.5])

def block(title,start,d_,core=None,splits=None):
    grid=spx.loc[start:].index; trr=tr.pct_change().reindex(grid).fillna(0.0); cashr=cash.reindex(grid).ffill().fillna(0.0)
    df,A=E.build_scores(d_,grid)
    if core: df=df[[k for k in core if k in df.columns]]
    print(f"\n=== {title}: {grid[0].date()}..{grid[-1].date()} | "+" | ".join(f"{a or 'start'}..{b or 'end'}" for a,b in splits)+" ===")
    r0,e0=run("BASELINE",df,A,grid,trr,cashr,splits)
    print("--- (a) VIX handling ---")
    for k in ["cap35_-1","cap35_0","mom","drop"]: run(f"VIX {k}",vix_variant(df,A,k),A,grid,trr,cashr,splits)
    print("--- (b) new indicators, each added alone (own family unless noted) ---")
    S=new_scores(grid); res={}
    for nm,(sc,blk,ld) in S.items():
        if sc.notna().mean()<0.3: print(f"  {nm}: coverage {sc.notna().mean():.2f} too low in this window, skipped"); continue
        fam = "ig" if nm=="ig_mom" else None
        dfx=add_indicator(df,nm,sc,blk,fam,ld)
        res[nm]=run(f"+ {nm} ({blk}{', fam ig' if fam else ''})",dfx,A,grid,trr,cashr,splits)
        del E.FAM[nm]
    print("--- (c) candidate packages ---")
    r1,e1=run("V5a = reentry floor 65% (>200DMA)",df,A,grid,trr,cashr,splits,post=lambda e:reentry(e,grid,0.65))
    dfv=vix_variant(df,A,"cap35_0")
    r2,e2=run("V5b = V5a + VIX>35 -> 0",dfv,A,grid,trr,cashr,splits,post=lambda e:reentry(e,grid,0.65))
    r3,e3=run("V5c = V5b + rungs 100/100/85/50/0",dfv,A,grid,trr,cashr,splits,post=lambda e:reentry(e,grid,0.65),rungs={4:1,3:1,2:.85,1:.5,0:0})
    r4,e4=run("V5d = V5b + rungs 100/100/100/50/0 (3-state)",dfv,A,grid,trr,cashr,splits,post=lambda e:reentry(e,grid,0.65),rungs={4:1,3:1,2:1,1:.5,0:0})
    r5,e5=run("V5e = V5b + rateshock ind",add_indicator(dfv,"rateshock",S["rateshock"][0],"macro",None,True),A,grid,trr,cashr,splits,post=lambda e:reentry(e,grid,0.65)); E.FAM.pop("rateshock",None)
    print("--- significance (paired block bootstrap 63d, Sharpe diff vs BASELINE, full window) ---")
    for nm,rr in [("V5a",r1),("V5b",r2),("V5c",r3),("V5d",r4),("V5e",r5)]:
        obs,p,ci=paired_boot(rr,r0,cashr); print(f"  {nm}: dSharpe {obs:+.3f}  P(<=0)={p:.3f}  95%CI [{ci[0]:+.3f},{ci[1]:+.3f}]")
    # ex-crisis attribution for V5b vs baseline
    crash=pd.Series(False,index=grid)
    for a_,b_ in [("2008-09-01","2009-06-30"),("2020-02-19","2020-06-30")]: crash.loc[a_:b_]=True
    m=~crash
    def sh(x): return (x-cashr.reindex(x.index)).mean()*252/(x.std()*np.sqrt(252))
    print(f"  ex-GFC/COVID Sharpe: BASELINE {sh(r0[m]):.3f}  V5b {sh(r2[m]):.3f}  V5d {sh(r4[m]):.3f}  BH {sh((trr)[m]):.3f}")
    # exposure in deep drawdown after V5
    p=spx.reindex(grid).ffill(); dd=(p/p.rolling(252).max()-1)
    deep=dd<-0.2
    print(f"  avg exposure while >20% below 1y high: BASELINE {e0[deep].mean():.2f}  V5b {e2[deep].mean():.2f}  V5d {e4[deep].mean():.2f}")
    return dict(r0=r0,r1=r1,r2=r2,r3=r3,r4=r4)

R1=block("2003-2026 full panel","2003-01-01",d,splits=[(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)])
# long-history core
baa=L.fred("BAA10Y"); hy_full=d["BAMLH0A0HYM2"].s; ig_full=d["BAMLC0A0CM"].s
common=baa.index.intersection(hy_full.index); bh=np.polyfit(baa.reindex(common),hy_full.reindex(common),1)
hy_ext=pd.concat([(bh[0]*baa+bh[1])[baa.index<hy_full.index[0]],hy_full]).sort_index()
dx_b=d["DTWEXBGS"].s; dx_m=L.fred("DTWEXM"); j=dx_b.index[0]; scale=dx_b.iloc[0]/dx_m.asof(j); dx_ext=pd.concat([(dx_m[dx_m.index<j]*scale),dx_b]).sort_index()
d2=dict(d); d2["BAMLH0A0HYM2"]=E.D(hy_ext,1); d2["DTWEXBGS"]=E.D(dx_ext,4); d2["BTC"]=None
CORE=["spx","spx_mom","vix","hy","hy_mom","ig","sloos","nfci","ratevol","payrolls","sahm","claims","curve","jpy","oil","dxy","cny","goldreal"]
R2=block("1990-2026 CORE","1990-01-01",d2,core=CORE,splits=[(None,None),("1990-01-01","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01",None)])
