# -*- coding: utf-8 -*-
"""A13: evaluate dated public calls of Capital Flows against subsequent prices.
Input CSV (extdata/capitalflows/CALLS.csv) columns: date (ISO, publication date), asset (key below), direction (+1 long/-1 short/0 neutral),
horizon_days (trading days; default 21 if blank), source (post title/url), note.
Assets: SPX, NDX, RUT, SMH, TLT, UST10, DOLLAR, USDJPY, GOLD, WTI, COPPER, VIX, HYG, BTC, EURUSD.
Output: per-call realized return over 5/21/63 trading days from the NEXT close after the date (PIT), hit rate, mean signed return,
comparison with random-direction baseline and with 'always long' baseline for the same dates/assets."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L
d=L.load_all(); spx=d["SPX"].s
def Y(n):
    try: return L.yahoo(n)
    except Exception: return None
def F(n):
    try: return L.fred(n)
    except Exception: return None
P={"SPX":d["SP500TR"].s,"NDX":Y("NDX"),"RUT":Y("RUT"),"SMH":Y("SMH"),"TLT":Y("TLT"),"DOLLAR":d["DTWEXBGS"].s,"USDJPY":d["DEXJPUS"].s,"GOLD":Y("GOLD"),"WTI":d["DCOILWTICO"].s,"COPPER":Y("HG"),"VIX":d["VIXCLS"].s,"HYG":Y("HYG"),"BTC":d["BTC"].s if d.get("BTC") is not None else None,"EURUSD":F("DEXUSEU")}
g10=F("DGS10")
if g10 is not None:
    y=g10/100; dy=y.diff(); P["UST10"]=(1+(y.shift(1)/252-8.5*dy).fillna(0)).cumprod()
P={k:v for k,v in P.items() if v is not None}
path=sys.argv[1] if len(sys.argv)>1 else os.path.join(os.path.dirname(os.path.abspath(__file__)),"extdata","capitalflows","CALLS.csv")
TAG="_full" if len(sys.argv)>1 else ""
if not os.path.exists(path):
    print("no CALLS.csv yet at",path); sys.exit(0)
C=pd.read_csv(path); C["date"]=pd.to_datetime(C["date"]); C["direction"]=pd.to_numeric(C["direction"],errors="coerce").fillna(0)
C["horizon_days"]=pd.to_numeric(C.get("horizon_days"),errors="coerce").fillna(21).astype(int)
rows=[]
for _,c in C.iterrows():
    a=str(c["asset"]).strip().upper()
    if a not in P or c["direction"]==0: continue
    px=P[a].dropna(); px=px[px.index>c["date"]]
    if len(px)<70: continue
    p0=px.iloc[0]; rec=dict(date=c["date"].date(),asset=a,dir=int(c["direction"]),source=str(c.get("source",""))[:60],note=str(c.get("note",""))[:60])
    for h in (5,21,63,int(c["horizon_days"])):
        if len(px)>h: rec[f"r{h}"]=(px.iloc[h]/p0-1)*100*c["direction"]
    rows.append(rec)
R=pd.DataFrame(rows)
pd.set_option("display.width",250); pd.set_option("display.max_rows",300)
print(R.round(2).to_string(index=False))
print("\n=== summary (signed returns, % ; positive = call was right) ===")
for h in (5,21,63):
    x=R[f"r{h}"].dropna()
    if len(x): print(f"  h={h:3}d: n={len(x)} hit {(x>0).mean()*100:.0f}%  mean {x.mean():+.2f}%  median {x.median():+.2f}%  t={x.mean()/(x.std()/np.sqrt(len(x))):+.2f}")
# baseline: same dates/assets always long
print("\n=== baseline: always long same asset/date ===")
for h in (5,21,63):
    x=(R[f"r{h}"]*R["dir"]).dropna()
    if len(x): print(f"  h={h:3}d: hit {(x>0).mean()*100:.0f}%  mean {x.mean():+.2f}%")
R["year"]=pd.to_datetime(R["date"]).dt.year
print("\nby year: n, hit21, hit63, mean63"); print(R.groupby("year").agg(n=("r21","count"),hit21=("r21",lambda x:(x>0).mean()),hit63=("r63",lambda x:(x>0).mean()),mean63=("r63","mean")).round(2).to_string())
print("\nby direction (h=63):"); print(R.groupby("dir").agg(n=("r63","count"),hit63=("r63",lambda x:(x>0).mean()),mean63=("r63","mean")).round(2).to_string())
print("\nby asset (h=21 and h=63):"); print(R.groupby("asset").agg(n=("r21","count"),hit21=("r21",lambda x:(x>0).mean()),mean21=("r21","mean"),hit63=("r63",lambda x:(x>0).mean()),mean63=("r63","mean")).round(2).to_string())
R.to_csv("out/a13_calls_eval%s.csv"%TAG,index=False)
