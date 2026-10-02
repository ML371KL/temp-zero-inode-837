"""B1: one-at-a-time evaluation of candidate changes on the 3-rung machine, averaged over a threshold neighbourhood."""
import sys, itertools
import numpy as np, pandas as pd
import r5, harness as H, eng5 as E5

d = r5.data(); g = r5.grid("2003-01-01")
px = d["SPX"].s.reindex(g).ffill()
fwdmin = pd.concat([px.shift(-k) for k in range(1, 64)], axis=1).min(axis=1)
dd10 = ((fwdmin / px - 1) <= -0.10).astype(float); dd10[px.shift(-63).isna()] = np.nan
def auc(score, y):
    m = score.notna() & y.notna(); s = score[m]; yy = y[m]
    r = s.rank(); n1 = yy.sum(); n0 = len(yy) - n1
    return (r[yy == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)
NB = [(t1, t2) for t1 in (-14, -12, -10, -8, -6) for t2 in (-34, -30, -26)]
WIN = (("2003-01-01", "2026-12-31"), ("2003-01-01", "2014-12-31"), ("2015-01-01", "2026-12-31"))
trr, cash = r5.returns(g)
def evalset(flags, label):
    out, df, A = E5.build(d, g, flags=flags)
    res = {w: [] for w in WIN}
    for t1, t2 in NB:
        expo, _ = E5.machine3(out, T1=t1, T2=t2)
        r, e = r5.run(expo, g)
        for a, b in WIN:
            m = H.metrics(r[a:b], cash[a:b]); res[(a, b)].append((m["sharpe"], m["cagr"], m["maxdd"]))
    cols = []
    for w in WIN:
        x = np.array(res[w]); cols.append(f"Sh {x[:,0].mean():.3f}±{x[:,0].std():.3f} CAGR {x[:,1].mean()*100:5.2f} DD {x[:,2].mean()*100:6.1f}")
    a = auc(-out["composite"], dd10)
    print(f"{label:22s} AUC {a:.3f} med {out['composite'].median():5.1f} | " + " | ".join(cols), flush=True)
    return out
evalset((), "LIVE")
for f in ["OIL", "OIL2", "IGF", "IGP", "HYZ", "SPZ", "NFR", "NFQ", "CRV", "TGW", "TGD", "SOF", "RGC", "POL", "RRL", "HMF", "LDW", "HAWK"]:
    evalset((f,), f)
