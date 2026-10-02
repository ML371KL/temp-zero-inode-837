import numpy as np, pandas as pd
import r5, eng5 as E5
from logit import LogisticRegression
d = r5.data(); g = r5.grid("2000-01-03")
out, df, A = E5.build(d, g, flags=("OIL", "TGD", "POL", "SOF"))
px = d["SPX"].s.reindex(g).ffill()
fwdmin = pd.concat([px.shift(-k) for k in range(1, 64)], axis=1).min(axis=1)
y = ((fwdmin / px - 1) <= -0.10).astype(float); y[px.shift(-63).isna()] = np.nan
hi = px.rolling(252, min_periods=60).max(); ddh = (px / hi - 1) * 100
vix = A["vix"]; vch = A["vix_chg30"]; hym = A["hy_mom"]
X = pd.DataFrame({"comp": out["composite"], "lead": out["lead"], "ddh": ddh, "vix": vix, "vch": vch, "hym": hym}, index=g)
ok = X.notna().all(axis=1) & y.notna() & (out["cover"] >= 0.45)
X, yy = X[ok], y[ok]
print("n", len(yy), "base rate", round(yy.mean() * 100, 1))
def brier(p, t): return float(((p - t) ** 2).mean())
FS = {"comp": ["comp"], "comp+ddh": ["comp", "ddh"], "comp+ddh+vix": ["comp", "ddh", "vix"], "comp+lead+ddh+vix": ["comp", "lead", "ddh", "vix"],
      "vix+ddh (no panel)": ["vix", "ddh"], "comp+ddh+vix+hym": ["comp", "ddh", "vix", "hym"]}
splits = [("2000-01-01", "2012-12-31", "2013-01-01", "2026-12-31"), ("2013-01-01", "2026-12-31", "2000-01-01", "2012-12-31")]
for nm, cols in FS.items():
    res = []
    for a, b, c, e in splits:
        tr = (X.index >= a) & (X.index <= b); te = (X.index >= c) & (X.index <= e)
        m = LogisticRegression(C=1.0, max_iter=1000).fit(X.loc[tr, cols], yy[tr])
        p = m.predict_proba(X.loc[te, cols])[:, 1]
        base = yy[tr].mean()
        res.append((brier(p, yy[te]), brier(np.full(te.sum(), base), yy[te])))
    m = LogisticRegression(C=1.0, max_iter=1000).fit(X[cols], yy)
    print(f"{nm:22s} OOS Brier skill: {[round(1 - a / b, 3) for a, b in res]}  coef {dict(zip(cols, m.coef_[0].round(4)))} b0 {m.intercept_[0]:.3f}")
cols = ["comp", "ddh", "vix"]
m = LogisticRegression(C=1.0, max_iter=1000).fit(X[cols], yy)
p = pd.Series(m.predict_proba(X[cols])[:, 1], index=X.index)
bins = pd.cut(p, [0, .05, .1, .15, .2, .3, .5, 1])
print(pd.DataFrame({"pred": p.groupby(bins).mean(), "obs": yy.groupby(bins).mean(), "n": yy.groupby(bins).size()}).round(3))
# simple bucket table alternative: composite bucket x drawdown bucket
cb = pd.cut(X["comp"], [-101, -30, -10, 10, 30, 101]); db = pd.cut(X["ddh"], [-100, -10, -5, 0.01])
print((yy.groupby([cb, db]).mean() * 100).round(1).unstack()); print(yy.groupby([cb, db]).size().unstack())
last = X.iloc[-1:]; print("last features", last.round(2).to_dict("records"), "p", round(float(m.predict_proba(last[cols])[:, 1][0]) * 100, 1))
# today from live (latest grid point incl. no label)
Xa = pd.DataFrame({"comp": out["composite"], "ddh": ddh, "vix": vix}, index=g).dropna()
print("today", Xa.iloc[-1].round(2).to_dict(), "p", round(float(m.predict_proba(Xa.iloc[-1:][cols])[:, 1][0]) * 100, 1))
