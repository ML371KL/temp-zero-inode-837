# -*- coding: utf-8 -*-
"""A15: Capital-Flows-style indicators added to the panel composite (a-priori zones, no tuning), tested by the audit bar:
2003-2026 (+halves) and 1990-2026 core (+3 sub-windows), paired block bootstrap vs baseline. Also as pure overlays.
Candidates: COT ES spec positioning (contrarian), COT DXY spec positioning (contrarian), NAAIM (contrarian), ACM term premium change,
ISM 3m change (growth momentum), real 10y 60d change (rate shock), implied correlation (COR1M, contrarian), auction bid-to-cover."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, metrics
HERE=os.path.dirname(os.path.abspath(__file__)); POS=os.path.join(HERE,"extdata","positioning"); EXT=os.path.join(HERE,"extdata")
d=L.load_all(); spx=d["SPX"].s; tr=d["SP500TR"].s; cash=d["DTB3"].s/100/252
def lag(s,days): return pd.Series(s.values,index=s.index+pd.Timedelta(days=days)).sort_index()
def ong(s,grid): s=s[~s.index.duplicated(keep="last")]; return s.reindex(s.index.union(grid)).ffill().reindex(grid)
def zs(s,win): return (s-s.rolling(win,min_periods=int(win*.6)).mean())/s.rolling(win,min_periods=int(win*.6)).std()
def pct(s,win): return s.rolling(win,min_periods=int(win*.6)).apply(lambda x:(x[:-1]<x[-1]).mean(),raw=True)
def csv(path,col=None):
    if not os.path.exists(path): return None
    df=pd.read_csv(path); dc=[c for c in df.columns if "date" in c.lower()][0]; df[dc]=pd.to_datetime(df[dc],errors="coerce"); df=df.dropna(subset=[dc]).set_index(dc).sort_index()
    s=pd.to_numeric(df[col] if col else df.iloc[:,0],errors="coerce").dropna(); return s[~s.index.duplicated(keep="last")]
def hard_market(A, grid):
    hy=A.get("hy",pd.Series(np.nan,index=grid)); hymom=A.get("hy_mom",pd.Series(np.nan,index=grid))
    vix=A.get("vix",pd.Series(np.nan,index=grid)); rvol=A.get("ratevol",pd.Series(0.0,index=grid)); jpyu=A.get("jpy_unwind",pd.Series(0.0,index=grid))
    return (((hy>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vix>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))
def mk_sig(df,A,grid):
    out=E.composite(df,A); HM=hard_market(A,grid); f=out["fund_fired"].astype(bool)
    out["fund"]=f; out["override"]=(f&(HM>=2)).astype(bool); out["hardMarket"]=HM; return out
def sh(x,c): return (x-c).mean()*252/(x.std()*np.sqrt(252))
def paired_boot(rA,rB,cashr,nb=2000,bl=63,seed=11):
    a=rA.values; b=rB.values; c=cashr.reindex(rA.index).values; n=len(a); rng=np.random.default_rng(seed); nblk=int(np.ceil(n/bl)); diffs=[]
    obs=sh(a,c)-sh(b,c)
    for _ in range(nb):
        st=rng.integers(0,n-bl,nblk); idx=np.concatenate([np.arange(s,s+bl) for s in st])[:n]
        diffs.append(sh(a[idx],c[idx])-sh(b[idx],c[idx]))
    diffs=np.array(diffs); return obs,(diffs<=0).mean()
def scores(grid):
    S={}
    es=csv(os.path.join(POS,"cot_legacy_sp500_emini.csv"),"net_noncomm_pct_oi")
    if es is not None:
        p=pct(es,156); sc=pd.Series(np.select([p>=0.9,p<=0.1],[-1,1],0),index=p.index,dtype=float); sc[p.isna()]=np.nan; S["cot_es"]=(ong(lag(sc.dropna(),3),grid),"market",True)
    dx=csv(os.path.join(POS,"cot_legacy_usd_index.csv"),"net_noncomm_pct_oi")
    if dx is not None:
        p=pct(dx,156); sc=pd.Series(np.select([p>=0.9,p<=0.1],[-1,1],0),index=p.index,dtype=float); sc[p.isna()]=np.nan; S["cot_dxy"]=(ong(lag(sc.dropna(),3),grid),"regime",True)
    na=csv(os.path.join(POS,"naaim.csv"),"naaim_exposure_mean")
    if na is not None:
        z=zs(na,52); sc=pd.Series(np.select([z>1.5,z<-1.5],[-1,1],0),index=z.index,dtype=float); sc[z.isna()]=np.nan; S["naaim"]=(ong(lag(sc.dropna(),1),grid),"market",True)
    tp=csv(os.path.join(POS,"acm_tp10.csv"),"acm_tp10")
    if tp is not None:
        ch=(tp-tp.shift(63))*100; sc=pd.Series(np.select([ch>40,ch<-40],[-1,1],0),index=ch.index,dtype=float); sc[ch.isna()]=np.nan; S["acm_tp_chg"]=(ong(lag(sc.dropna(),1),grid),"macro",True)
    ism=csv(os.path.join(EXT,"ism_manufacturing_pmi.csv"))
    if ism is not None:
        ch=ism-ism.shift(3); sc=pd.Series(np.select([ch>3,ch<-3],[1,-1],0),index=ch.index,dtype=float); sc[ch.isna()]=np.nan; S["ism_chg"]=(ong(lag(sc.dropna(),3),grid),"macro",True)
    cor=csv(os.path.join(POS,"cboe_cor1m.csv"),"cor1m")
    if cor is not None:
        p=pct(cor,252); sc=pd.Series(np.select([p>=0.9,p<=0.1],[1,-1],0),index=p.index,dtype=float); sc[p.isna()]=np.nan; S["cor1m"]=(ong(lag(sc.dropna(),1),grid),"market",True)
    au=csv(os.path.join(POS,"auctions_notes.csv"),"bid_to_cover")
    if au is not None:
        m=au.groupby(au.index).mean().rolling(8).mean(); z=zs(m,60); sc=pd.Series(np.select([z<-1.0,z>1.0],[-1,1],0),index=z.index,dtype=float); sc[z.isna()]=np.nan; S["auction_btc"]=(ong(lag(sc.dropna(),1),grid),"macro",True)
    return S
def run(name,df,A,grid,trr,cashr,splits):
    sig=mk_sig(df,A,grid); e,_=ladder_machine(sig); r,ee=simulate(e,trr,cashr,cost_bps=10)
    s=f"{name:38}"
    for lo,hi in splits:
        rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index)); s+=f" | Sh {m['sharpe']:.3f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
    print(s); return r
def block(title,start,d_,core,splits):
    grid=spx.loc[start:].index; trr=tr.pct_change().reindex(grid).fillna(0.0); cashr=cash.reindex(grid).ffill().fillna(0.0)
    df,A=E.build_scores(d_,grid)
    if core: df=df[[k for k in core if k in df.columns]]
    print(f"\n=== {title}: {grid[0].date()}..{grid[-1].date()} | "+" | ".join(f"{a or 'start'}..{b or 'end'}" for a,b in splits)+" ===")
    r0=run("BASELINE",df,A,grid,trr,cashr,splits)
    S=scores(grid); res={}
    for nm,(sc,blk,ld) in S.items():
        cov=sc.notna().mean()
        if cov<0.3: print(f"  {nm}: coverage {cov:.2f} — skipped"); continue
        dfx=df.copy(); dfx[nm]=sc; E.FAM[nm]=(blk,nm,ld)
        r=run(f"+ {nm} ({blk}, cover {cov:.2f})",dfx,A,grid,trr,cashr,splits); res[nm]=r
        del E.FAM[nm]
        line="    dSh vs base:"
        for lo,hi in splits:
            obs,p=paired_boot(r.loc[lo:hi],r0.loc[lo:hi],cashr); line+=f"  {obs:+.3f} (P {p:.2f})"
        print(line)
    # all positioning together
    keys=[k for k in ("cot_es","cot_dxy","naaim") if k in S and S[k][0].notna().mean()>=0.3]
    if keys:
        dfx=df.copy()
        for k in keys: dfx[k]=S[k][0]; E.FAM[k]=(S[k][1],k,S[k][2])
        r=run("+ positioning trio ("+",".join(keys)+")",dfx,A,grid,trr,cashr,splits)
        for k in keys: del E.FAM[k]
        line="    dSh vs base:"
        for lo,hi in splits:
            obs,p=paired_boot(r.loc[lo:hi],r0.loc[lo:hi],cashr); line+=f"  {obs:+.3f} (P {p:.2f})"
        print(line)
block("2003-2026 full panel","2003-01-01",d,None,[(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)])
baa=L.fred("BAA10Y"); hy_full=d["BAMLH0A0HYM2"].s
common=baa.index.intersection(hy_full.index); bh=np.polyfit(baa.reindex(common),hy_full.reindex(common),1)
hy_ext=pd.concat([(bh[0]*baa+bh[1])[baa.index<hy_full.index[0]],hy_full]).sort_index()
dx_b=d["DTWEXBGS"].s; dx_m=L.fred("DTWEXM"); j=dx_b.index[0]; scale=dx_b.iloc[0]/dx_m.asof(j); dx_ext=pd.concat([(dx_m[dx_m.index<j]*scale),dx_b]).sort_index()
d2=dict(d); d2["BAMLH0A0HYM2"]=E.D(hy_ext,1); d2["DTWEXBGS"]=E.D(dx_ext,4); d2["BTC"]=None
CORE=["spx","spx_mom","vix","hy","hy_mom","ig","sloos","nfci","ratevol","payrolls","sahm","claims","curve","jpy","oil","dxy","cny","goldreal"]
block("1990-2026 CORE","1990-01-01",d2,CORE,[(None,None),("1990-01-01","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01",None)])
