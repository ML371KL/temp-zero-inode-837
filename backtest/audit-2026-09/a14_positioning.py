# -*- coding: utf-8 -*-
"""A14: positioning & capital-flow signals (COT, NAAIM, ACM term premium, TIC, Fed custody, auctions) as SPX/bond predictors,
PIT-lagged; IC, terciles/extremes, and ladder overlays. Loads whatever exists in extdata/positioning/ (skips missing)."""
import sys, os, glob, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from scipy import stats
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, metrics
POS=os.path.join(os.path.dirname(os.path.abspath(__file__)),"extdata","positioning")
d=L.load_all(); spx=d["SPX"].s; tr=d["SP500TR"].s; cash=d["DTB3"].s/100/252
START=sys.argv[1] if len(sys.argv)>1 else "1990-01-01"
grid=spx.loc[START:].index; wk=grid[::5]; cashg=cash.reindex(grid).ffill().fillna(0)
trg=tr.reindex(grid).ffill()
fx={h:np.log(trg.shift(n)/trg)*0 for h,n in []}
H={"1m":21,"3m":63}
fx={k:(np.log(trg.shift(-h)/trg)-cashg.rolling(h).sum().shift(-h)) for k,h in H.items()}
g10=L.fred("DGS10"); y=g10.reindex(grid).ffill()/100; bond=(1+(y.shift(1)/252-8.5*y.diff()).fillna(0)).cumprod()
fxb={k:np.log(bond.shift(-h)/bond) for k,h in H.items()}
def lag(s,days): return pd.Series(s.values,index=s.index+pd.Timedelta(days=days)).sort_index()
def ong(s): s=s[~s.index.duplicated(keep="last")]; return s.reindex(s.index.union(grid)).ffill().reindex(grid)
def zs(s,win): return (s-s.rolling(win,min_periods=int(win*.6)).mean())/s.rolling(win,min_periods=int(win*.6)).std()
def pct(s,win): return s.rolling(win,min_periods=int(win*.6)).apply(lambda x:(x[:-1]<x[-1]).mean(),raw=True)
def load(name):
    p=os.path.join(POS,name)
    if not os.path.exists(p): return None
    df=pd.read_csv(p); df.columns=[c.strip().lower() for c in df.columns]
    dc=[c for c in df.columns if "date" in c][0]; df[dc]=pd.to_datetime(df[dc],errors="coerce"); df=df.dropna(subset=[dc]).sort_values(dc).set_index(dc)
    return df
V={}
print("files:", sorted(os.path.basename(x) for x in glob.glob(os.path.join(POS,"*.csv"))))
# --- COT legacy / TFF: any file with 'net' column ---
COTSEL=[("cot_legacy_sp500_emini.csv","net_noncomm_pct_oi","ES spec net %OI"),("cot_legacy_sp500_consolidated.csv","net_noncomm_pct_oi","SPX cons spec net %OI"),
        ("cot_tff_sp500_consolidated.csv","net_asset_mgr_pct_oi","SPX asset-mgr net %OI"),("cot_tff_sp500_consolidated.csv","net_lev_money_pct_oi","SPX lev-funds net %OI"),
        ("cot_legacy_ust_10y.csv","net_noncomm_pct_oi","UST10 spec net %OI"),("cot_tff_ust_10y.csv","net_lev_money_pct_oi","UST10 lev-funds net %OI"),
        ("cot_legacy_vix.csv","net_noncomm_pct_oi","VIX spec net %OI"),("cot_legacy_usd_index.csv","net_noncomm_pct_oi","DXY spec net %OI"),("cot_legacy_jpy.csv","net_noncomm_pct_oi","JPY spec net %OI")]
for fn,col,lab in COTSEL:
    df=load(fn)
    if df is None or col not in df.columns: continue
    s=pd.to_numeric(df[col],errors="coerce").dropna()
    if len(s)<100: continue
    V[f"COT {lab} z52"]=ong(lag(zs(s,52),3)); V[f"COT {lab} pct156"]=ong(lag(pct(s,156),3))
for fn,lab in [("cboe_cor1m.csv","CBOE COR1M"),("cboe_vvix.csv","VVIX"),("cboe_skew.csv","SKEW 21d")]:
    df=load(fn)
    if df is None: continue
    s=pd.to_numeric(df.iloc[:,0],errors="coerce").dropna()
    if "SKEW" in lab: s=s.rolling(21).mean()
    V[lab]=ong(lag(s,1)); V[lab+" z252"]=ong(lag(zs(s,252),1))
na=load("naaim.csv")
if na is not None:
    s=pd.to_numeric(na.iloc[:,0],errors="coerce").dropna(); V["NAAIM level"]=ong(lag(s,1)); V["NAAIM z52"]=ong(lag(zs(s,52),1))
acm=load("acm_tp10.csv")
if acm is not None:
    s=pd.to_numeric(acm.iloc[:,0],errors="coerce").dropna(); V["ACM TP10 level"]=ong(lag(s,1)); V["ACM TP10 Δ63d"]=ong(lag(s-s.shift(63),1))
for fn,lab,lg in [("tic_net_lt_purchases.csv","TIC net LT purchases (3m sum)",45),("tic_foreign_holdings_total.csv","TIC foreign UST holdings yoy %",45),("fed_custody_foreign.csv","Fed custody foreign Δ13w %",2)]:
    df=load(fn)
    if df is None: continue
    s=pd.to_numeric(df.iloc[:,0],errors="coerce").dropna()
    if "purchases" in fn: s=s.rolling(3).sum()
    elif "holdings" in fn: s=(s/s.shift(12)-1)*100
    else: s=(s/s.shift(13)-1)*100
    V[lab]=ong(lag(s,lg))
au=load("auctions_notes.csv")
if au is not None:
    btc=[c for c in au.columns if "bidtocover" in c.replace(" ","").replace("_","")]
    if btc:
        s=pd.to_numeric(au[btc[0]],errors="coerce").dropna(); s=s.groupby(s.index).mean(); V["auction bid-to-cover (notes, 8-auction avg)"]=ong(lag(s.rolling(8).mean(),1))
if not V: print("no positioning variables loaded"); sys.exit(0)
print(f"=== A14 positioning/flows, {grid[0].date()}..{grid[-1].date()} ===")
rows=[]
for k,s in V.items():
    rec={"var":k,"cover":round(s.notna().mean(),2)}
    for hk in H:
        m=pd.concat([s.reindex(wk),fx[hk].reindex(wk)],axis=1).dropna(); mb=pd.concat([s.reindex(wk),fxb[hk].reindex(wk)],axis=1).dropna()
        rec[f"icSPX_{hk}"]=stats.spearmanr(m.iloc[:,0],m.iloc[:,1]).correlation if len(m)>80 else np.nan
        rec[f"icBond_{hk}"]=stats.spearmanr(mb.iloc[:,0],mb.iloc[:,1]).correlation if len(mb)>80 else np.nan
        rec["n"]=len(m)
    rows.append(rec)
R=pd.DataFrame(rows).set_index("var"); pd.set_option("display.width",220); pd.set_option("display.max_rows",100)
print(R.round(3).to_string())
print("\n--- forward 3m SPX excess by tercile / extremes (top & bottom decile) ---")
for k,s in V.items():
    m=pd.concat([s.reindex(wk),fx["3m"].reindex(wk)],axis=1).dropna()
    if len(m)<120: continue
    t=pd.qcut(m.iloc[:,0].rank(method="first"),3,labels=["low","mid","high"])
    g=m.groupby(t).apply(lambda z:(z.iloc[:,1].mean()*4*100,len(z)))
    dl=m[m.iloc[:,0]<=m.iloc[:,0].quantile(.1)].iloc[:,1]; dh=m[m.iloc[:,0]>=m.iloc[:,0].quantile(.9)].iloc[:,1]
    print(f"  {k:46}", " | ".join(f"{i}: {v[0]:+5.1f}% n={v[1]}" for i,v in g.items()), f" | bottom10% {dl.mean()*4*100:+5.1f}% top10% {dh.mean()*4*100:+5.1f}%")
# ladder overlays (2003 panel): cap 65% when positioning extreme high (top decile), floor when extreme low
print("\n--- ladder overlays (2003-2026): cap 65% when variable in top decile (crowded long) / floor 65% in bottom decile ---")
g03=spx.loc["2003-01-01":].index; trr=tr.pct_change().reindex(g03).fillna(0.0); cashr=cash.reindex(g03).ffill().fillna(0.0)
df,Ax=E.build_scores(d,g03); out=E.composite(df,Ax)
hyv=Ax.get("hy"); hymom=Ax.get("hy_mom"); vixv=Ax.get("vix"); rvol=Ax.get("ratevol",pd.Series(0.0,index=g03)); jpyu=Ax.get("jpy_unwind",pd.Series(0.0,index=g03))
HM=(((hyv>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vixv>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))
f=out["fund_fired"].astype(bool); out["fund"]=f; out["override"]=(f&(HM>=2)).astype(bool)
e0,_=ladder_machine(out)
def summ(name,e):
    r,ee=simulate(e,trr,cashr,cost_bps=10); s=f"{name:56}"
    for lo,hi in [(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)]:
        rr=r.loc[lo:hi]; m=metrics(rr,cashr.reindex(rr.index)); s+=f" | Sh {m['sharpe']:.3f} DD {m['maxdd']*100:5.1f} CAGR {m['cagr']*100:5.2f} E {ee.loc[lo:hi].mean():.2f}"
    print(s)
summ("BASELINE",e0)
for k,s in V.items():
    s3=s.reindex(g03); q9=s3.expanding(min_periods=252).quantile(.9); q1=s3.expanding(min_periods=252).quantile(.1)
    hi=(s3>=q9).shift(1).fillna(False); lo=(s3<=q1).shift(1).fillna(False)
    e=e0.copy(); e[hi]=np.minimum(e[hi],0.65); summ(f"cap65 top-decile [{k[:40]}]",e)
    e=e0.copy(); e[lo]=np.maximum(e[lo],0.65); summ(f"floor65 bottom-decile [{k[:40]}]",e)
os.makedirs("out",exist_ok=True); R.to_csv(f"out/a14_ic_{START[:4]}.csv"); pd.DataFrame(V).to_csv(f"out/a14_vars_{START[:4]}.csv")
