"""Loader for the audit: reads data/ (FRED csv + Yahoo ndjson chunks), patches engine.py
so that engine.load_all()/build_scores/composite work on the extended data set.
Also merges the full-history BAML mirror (2000-2026-07) with the fresh FRED window."""
import os, json, sys
import pandas as pd, numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
DATA=os.path.join(HERE,"data")
MIRROR=os.path.join(HERE,"..","independent-backtest","data")
sys.path.insert(0,HERE)
import engine as E
E.DATA=DATA

def fred(series):
    p=os.path.join(DATA,series+".csv")
    df=pd.read_csv(p); df.columns=["date","v"]
    df["date"]=pd.to_datetime(df["date"]); df["v"]=pd.to_numeric(df["v"],errors="coerce")
    s=df.dropna().set_index("date")["v"].sort_index()
    if series in ("BAMLH0A0HYM2","BAMLC0A0CM"):
        mp=os.path.join(MIRROR,series+".csv")
        if os.path.exists(mp):
            m=pd.read_csv(mp); m.columns=["date","v"]; m["date"]=pd.to_datetime(m["date"]); m["v"]=pd.to_numeric(m["v"],errors="coerce")
            m=m.dropna().set_index("date")["v"].sort_index()
            s=pd.concat([m[~m.index.isin(s.index)],s]).sort_index()
    return s[~s.index.duplicated(keep="last")]

def yahoo(name):
    p=os.path.join(DATA,name+".ndjson")
    parts=[]
    with open(p,encoding="utf-8") as f:
        for line in f:
            line=line.strip()
            if not line: continue
            j=json.loads(line)
            r=j["chart"]["result"][0]
            if "timestamp" not in r: continue
            ts=pd.to_datetime(pd.Series(r["timestamp"]),unit="s").dt.normalize()
            q=r["indicators"]["quote"][0]
            parts.append(pd.DataFrame({"close":q["close"],"open":q.get("open"),"high":q.get("high"),"low":q.get("low"),"vol":q.get("volume")},index=ts))
    df=pd.concat(parts).sort_index()
    df=df[~df.index.duplicated(keep="last")]
    return df["close"].dropna()

E.fred=fred; E.yahoo=yahoo

CURRENT=frozenset(["V1","V2","V4","V5","V7","V8","VT","OH"])   # = live page v4.13.9 logic
_bs=E.build_scores; _cp=E.composite
def build_scores(d,grid,era_fair=False,variants=None):
    return _bs(d,grid,era_fair=era_fair,variants=CURRENT if variants is None else variants)
def composite(df,A,variants=None):
    return _cp(df,A,variants=CURRENT if variants is None else variants)
E.build_scores=build_scores; E.composite=composite

def load_all():
    d=E.load_all()
    return d

def fwd_returns(tr, horizons=(21,63,126,252)):
    """forward log returns of total-return index over trading-day horizons."""
    out={}
    for h in horizons:
        out[h]=np.log(tr.shift(-h)/tr)
    return pd.DataFrame(out)

if __name__=="__main__":
    d=load_all()
    for k,v in d.items():
        if v is None: print(k,"NONE"); continue
        print(f"{k:14} {len(v.s):6} {v.s.index[0].date()} .. {v.s.index[-1].date()}")
