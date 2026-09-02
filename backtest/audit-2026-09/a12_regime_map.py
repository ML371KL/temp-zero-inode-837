# -*- coding: utf-8 -*-
"""A12: multi-asset regime map skeleton (Capital-Flows-style reads reconstructed from free data), PIT-lagged.
Regime variables: growth level/momentum (CFNAI, INDPRO, payrolls), inflation momentum (core CPI 3m ann - yoy),
Fed stance (real FF; FF vs nominal GDP), real 10y & breakevens, 30y at 1y highs, bear steepening, HY percentile,
vol term structure (VIX/VIX3M, VIX9D/VIX), MOVE, FX realized vol, dollar, net liquidity.
Outputs: forward 1m/3m returns by regime for SPX, 10y bonds (TLT / DGS10 proxy), dollar, gold, oil, copper; IC of each
variable vs SPX forward; and ladder overlays of the two headline 'risk' reads."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from scipy import stats
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, metrics
EXT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"extdata")
d=L.load_all(); spx=d["SPX"].s; tr=d["SP500TR"].s; cash=d["DTB3"].s/100/252
START=sys.argv[1] if len(sys.argv)>1 else "1990-01-01"
grid=spx.loc[START:].index
def F(n):
    try: return L.fred(n)
    except Exception: return None
def Y(n):
    try: return L.yahoo(n)
    except Exception: return None
def ext(name):
    p=os.path.join(EXT,name+".csv")
    if not os.path.exists(p): return None
    df=pd.read_csv(p).iloc[:,:2]; df.columns=["date","v"]; df["date"]=pd.to_datetime(df["date"]); df["v"]=pd.to_numeric(df["v"],errors="coerce")
    return df.dropna().set_index("date")["v"].sort_index()
def lag(s,days): return pd.Series(s.values,index=s.index+pd.Timedelta(days=days)).sort_index()
def ong(s): s=s[~s.index.duplicated(keep="last")]; return s.reindex(s.index.union(grid)).ffill().reindex(grid)
def pct_rank(s,win): return s.rolling(win,min_periods=int(win*0.6)).apply(lambda x:(x[:-1]<x[-1]).mean(),raw=True)

# ---------- assets (daily total-return proxies on grid) ----------
A={}
A["SPX"]=tr.reindex(grid).ffill()
tlt=Y("TLT"); g10=F("DGS10")
# 10y bond TR proxy from yield: r_t = y/252 - D*dy, D~8.5 (used pre-2002 and as check)
y=g10.reindex(grid).ffill()/100; dy=y.diff(); bond_proxy=(1+ (y.shift(1)/252 - 8.5*dy).fillna(0)).cumprod()
A["UST10 (proxy)"]=bond_proxy
if tlt is not None: A["TLT"]=tlt.reindex(grid).ffill()
dx_b=d["DTWEXBGS"].s; dx_m=F("DTWEXM"); j=dx_b.index[0]; sc=dx_b.iloc[0]/dx_m.asof(j); dxy=pd.concat([dx_m[dx_m.index<j]*sc,dx_b]).sort_index()
A["Dollar"]=dxy.reindex(grid).ffill()
gc=Y("GOLD"); hg=Y("HG"); oil=d["DCOILWTICO"].s
if gc is not None: A["Gold"]=gc.reindex(grid).ffill()
A["WTI"]=oil.reindex(grid).ffill()
if hg is not None: A["Copper"]=hg.reindex(grid).ffill()
ndx=Y("NDX"); rut=Y("RUT")
if ndx is not None: A["NDX/SPX"]=(ndx.reindex(grid).ffill()/spx.reindex(grid).ffill())
if rut is not None: A["RUT/SPX"]=(rut.reindex(grid).ffill()/spx.reindex(grid).ffill())
H={"1m":21,"3m":63}
def fwd(s,h): return np.log(s.shift(-h)/s)

# ---------- regime variables (PIT) ----------
V={}
cfn=F("CFNAI")
if cfn is not None:
    ma3=cfn.rolling(3).mean(); V["growth_level (CFNAI-MA3)"]=ong(lag(ma3,25)); V["growth_mom (ΔCFNAI-MA3, 3m)"]=ong(lag(ma3-ma3.shift(3),25))
ind=F("INDPRO")
if ind is not None: V["INDPRO 3m ann %"]=ong(lag((ind/ind.shift(3))**4*100-100,17))
pay=F("PAYEMS")
if pay is not None: V["payrolls 3m avg chg"]=ong(lag(pay.diff().rolling(3).mean(),35))
ism=ext("ism_manufacturing_pmi")
if ism is not None: V["ISM level (2007+)"]=ong(lag(ism,3)); V["ISM Δ3m"]=ong(lag(ism-ism.shift(3),3))
cpi=F("CPILFESL")
if cpi is not None:
    yoy=(cpi/cpi.shift(12)-1)*100; m3=((cpi/cpi.shift(3))**4-1)*100
    V["core CPI yoy"]=ong(lag(yoy,43)); V["infl_mom (3m ann − yoy)"]=ong(lag(m3-yoy,43))
ff=F("DFF"); gdp=F("GDP")
if ff is not None and cpi is not None:
    ffm=ff.resample("MS").mean(); V["real FF (FF − core yoy)"]=ong(lag(ffm-yoy.reindex(ffm.index),43))
if ff is not None and gdp is not None:
    ngdp=(gdp/gdp.shift(4)-1)*100; ffq=ff.resample("QS").mean().reindex(ngdp.index)
    V["FF − nominal GDP yoy"]=ong(lag(ffq-ngdp,120))
r10=F("DFII10"); be=F("T10YIE")
if r10 is not None: V["real 10y level"]=ong(lag(r10,1)); V["real 10y Δ60d bp"]=ong(lag((r10-r10.shift(42))*100,1))
if be is not None: V["breakeven 10y Δ60d bp"]=ong(lag((be-be.shift(42))*100,1))
if r10 is not None and be is not None: V["real10 − breakeven (real minus infl exp)"]=ong(lag(r10-be.reindex(r10.index,method="ffill"),1))
g30=F("DGS30"); g2=F("DGS2")
if g30 is not None: V["30y yield vs 252d max (bp below)"]=ong(lag((g30-g30.rolling(252).max())*100,1))
if g10 is not None and g2 is not None:
    slope=g10-g2.reindex(g10.index,method="ffill"); V["10y−2y slope Δ60d bp"]=ong(lag((slope-slope.shift(42))*100,1))
    bear_steep=((slope-slope.shift(42))>0.15)&((g10-g10.shift(42))>0.25); V["bear steepening flag"]=ong(lag(bear_steep.astype(float),1))
hy=d["BAMLH0A0HYM2"].s; V["HY OAS pct rank 1y"]=ong(lag(pct_rank(hy,252),1)); V["HY OAS pct rank 3y"]=ong(lag(pct_rank(hy,756),1))
vix=d["VIXCLS"].s; vxv=F("VXVCLS"); v9=Y("VIX9D")
if vxv is not None: V["VIX/VIX3M"]=ong(lag(vix/vxv.reindex(vix.index),1))
if v9 is not None and len(v9)>200: V["VIX9D/VIX (1w vs 1m vol)"]=ong(lag(v9/vix.reindex(v9.index),1))
mv=Y("MOVE")
if mv is not None and len(mv)>200: V["MOVE"]=ong(lag(mv,1)); V["MOVE pct rank 1y"]=ong(lag(pct_rank(mv,252),1))
jp=d["DEXJPUS"].s; V["USDJPY realized vol 21d"]=ong(lag(np.log(jp).diff().rolling(21).std()*np.sqrt(252)*100,1))
V["dollar Δ60d %"]=ong(lag((dxy/dxy.shift(42)-1)*100,4))
w=F("WALCL"); tga=F("WTREGEN"); rrp=F("RRPONTSYD")
if w is not None and tga is not None and rrp is not None:
    tg=tga.where(tga<=2500,tga/1000.0); nl=(w/1000.0-tg.reindex(w.index,method="ffill")-rrp.reindex(w.index,method="ffill").fillna(0)); V["net liquidity Δ13w %"]=ong(lag((nl/nl.shift(13)-1)*100,2))
# combos from the previews
if "HY OAS pct rank 3y" in V and "30y yield vs 252d max (bp below)" in V:
    V["CF read: credit tight & 30y at highs (infl>recession risk)"]=((V["HY OAS pct rank 3y"]<0.2)&(V["30y yield vs 252d max (bp below)"]>-25)).astype(float)
if "growth_mom (ΔCFNAI-MA3, 3m)" in V and "real FF (FF − core yoy)" in V:
    V["CF read: growth decel & Fed restrictive (liquidity gap)"]=((V["growth_mom (ΔCFNAI-MA3, 3m)"]<0)&(V["real FF (FF − core yoy)"]>0.5)).astype(float)
if "growth_mom (ΔCFNAI-MA3, 3m)" in V and "infl_mom (3m ann − yoy)" in V:
    q=pd.Series(np.select([(V["growth_mom (ΔCFNAI-MA3, 3m)"]>=0)&(V["infl_mom (3m ann − yoy)"]<0),(V["growth_mom (ΔCFNAI-MA3, 3m)"]>=0)&(V["infl_mom (3m ann − yoy)"]>=0),(V["growth_mom (ΔCFNAI-MA3, 3m)"]<0)&(V["infl_mom (3m ann − yoy)"]>=0)],[1,2,3],4),index=grid,dtype=float)
    q[V["growth_mom (ΔCFNAI-MA3, 3m)"].isna()|V["infl_mom (3m ann − yoy)"].isna()]=np.nan
    V["quadrant (1 G↑I↓ 2 G↑I↑ 3 G↓I↑ 4 G↓I↓)"]=q

wk=grid[::5]
cashg=cash.reindex(grid).ffill().fillna(0)
print(f"=== A12 regime map, {grid[0].date()}..{grid[-1].date()} ===")
print("\n--- (1) Spearman IC of each regime variable vs forward SPX excess return (weekly samples) ---")
fx={k:(fwd(A["SPX"],h)-cashg.rolling(h).sum().shift(-h)) for k,h in H.items()}
rows=[]
for k,s in V.items():
    rec={"var":k,"cover":round(s.notna().mean(),2)}
    for hk in H:
        m=pd.concat([s.reindex(wk),fx[hk].reindex(wk)],axis=1).dropna()
        rec[f"ic_{hk}"]=stats.spearmanr(m.iloc[:,0],m.iloc[:,1]).correlation if len(m)>80 else np.nan
        rec[f"n_{hk}"]=len(m)
    rows.append(rec)
R=pd.DataFrame(rows).set_index("var"); pd.set_option("display.width",220); pd.set_option("display.max_rows",100)
print(R.round(3).to_string())
print("\n--- (2) Forward returns by regime read (annualized %, 3m horizon) for each asset ---")
def by_flag(name):
    s=V[name]
    print(f"\n{name}:")
    for a,px in A.items():
        f3=fwd(px,63)
        out=[]
        for val in sorted(s.dropna().unique()):
            x=f3[s==val].dropna()
            if len(x)>60: out.append(f"{val:.0f}: {x.mean()*4*100:+6.1f}% (n={len(x)})")
        print(f"  {a:14}", " | ".join(out))
for name in [k for k in V if k.startswith("CF read") or k.startswith("quadrant") or k=="bear steepening flag"]:
    by_flag(name)
print("\n--- (3) Forward 3m SPX excess by tercile of continuous reads ---")
for k in ["real FF (FF − core yoy)","FF − nominal GDP yoy","real10 − breakeven (real minus infl exp)","HY OAS pct rank 3y","VIX/VIX3M","MOVE pct rank 1y","USDJPY realized vol 21d","net liquidity Δ13w %","growth_mom (ΔCFNAI-MA3, 3m)","infl_mom (3m ann − yoy)"]:
    if k not in V: continue
    s=V[k]; m=pd.concat([s.reindex(wk),fx["3m"].reindex(wk)],axis=1).dropna()
    if len(m)<100: continue
    t=pd.qcut(m.iloc[:,0].rank(method="first"),3,labels=["low","mid","high"])
    g=m.groupby(t).apply(lambda z:(z.iloc[:,1].mean()*4*100, (z.iloc[:,1]>0).mean()*100, len(z)))
    print(f"  {k:44}", " | ".join(f"{i}: {v[0]:+5.1f}% hit {v[1]:.0f}% n={v[2]}" for i,v in g.items()))
# ---------- (4) ladder overlays with the CF reads ----------
print("\n--- (4) Ladder overlays: cap exposure when a CF risk read is on (2003-2026 panel) ---")
g03=spx.loc["2003-01-01":].index; trr=tr.pct_change().reindex(g03).fillna(0.0); cashr=cash.reindex(g03).ffill().fillna(0.0)
df,Ax=E.build_scores(d,g03); out=E.composite(df,Ax)
hyv=Ax.get("hy"); hymom=Ax.get("hy_mom"); vixv=Ax.get("vix"); rvol=Ax.get("ratevol",pd.Series(0.0,index=g03)); jpyu=Ax.get("jpy_unwind",pd.Series(0.0,index=g03))
HM=(((hyv>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vixv>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))
f=out["fund_fired"].astype(bool); out["fund"]=f; out["override"]=(f&(HM>=2)).astype(bool)
e0,_=ladder_machine(out)
def summ(name,e):
    r,ee=simulate(e,trr,cashr,cost_bps=10); s=f"{name:52}"
    for lo,hi in [(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)]:
        rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index)); s+=f" | Sh {m['sharpe']:.3f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
    print(s)
summ("BASELINE",e0)
for name in [k for k in V if k.startswith("CF read") or k=="bear steepening flag"]:
    flag=V[name].reindex(g03).shift(1).fillna(0)>0.5
    e=e0.copy(); e[flag]=np.minimum(e[flag],0.65); summ(f"cap 65% when [{name[:38]}]",e)
    share=flag.mean()*100; print(f"    (flag on {share:.1f}% of days)")
os.makedirs("out",exist_ok=True); pd.DataFrame(V).to_csv(f"out/a12_vars_{START[:4]}.csv"); R.to_csv(f"out/a12_ic_{START[:4]}.csv")
