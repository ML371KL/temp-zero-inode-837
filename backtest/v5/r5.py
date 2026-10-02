"""v5 research runner: shared data loading, simulation and reporting helpers."""
import os, sys, pickle
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import loader as L
import harness as H
import eng5 as E5

_D = None
def data():
    global _D
    if _D is None:
        pk = os.path.join(E5.CACHE, "data.pkl")
        if os.path.exists(pk):
            _D = pickle.load(open(pk, "rb"))
        else:
            d = L.load_all()
            for k in ("DFEDTARU", "DFEDTAR", "BAMLH0A3HYC", "BAMLH0A1HYBB", "RPONTTLD"):
                try:
                    s = L.fred(k)
                    d[k] = L.E.D(s, 1)
                except Exception as e:
                    print("no", k, e)
            # extend DFEDTARU with the mirror (older part)
            _D = d
            pickle.dump(d, open(pk, "wb"))
    return _D

def grid(start="2003-01-01", end=None):
    d = data()
    tr = d["SP500TR"].s
    g = tr.index[(tr.index >= start)]
    if end: g = g[g <= end]
    return g

def returns(g):
    d = data()
    tr = d["SP500TR"].s.reindex(g).ffill()
    trr = tr.pct_change().fillna(0.0)
    cash = d["DTB3"].s.reindex(g, method="ffill").fillna(0.0) / 100 / 252
    return trr, cash

def run(expo, g, cost=10.0):
    trr, cash = returns(g)
    r, e = H.simulate(expo.reindex(g).ffill(), trr, cash, cost_bps=cost)
    return r, e

def stats(r, e, g, label, windows=(("2003-01-01", "2026-12-31"), ("2003-01-01", "2014-12-31"), ("2015-01-01", "2026-12-31"))):
    trr, cash = returns(g)
    cols = []
    for a, b in windows:
        rr = r[a:b]; cc = cash[a:b]; ee = e[a:b]
        if len(rr) < 200: cols.append("    n/a                         "); continue
        m = H.metrics(rr, cc)
        trades = (ee.diff().abs() > 1e-9).sum() / (len(rr) / 252)
        cols.append(f"Sh {m['sharpe']:.2f} DD {m['maxdd']*100:6.1f} CAGR {m['cagr']*100:5.2f} E {ee.mean():.2f} tr {trades:4.1f}")
    print(f"{label:44s} | " + " | ".join(cols))

def bh(g):
    return pd.Series(1.0, index=g)
