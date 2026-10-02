import itertools, numpy as np, pandas as pd
import r5, harness as H, eng5 as E5
d = r5.data(); g = r5.grid("2000-01-03"); trr, cash = r5.returns(g)
FL = ("OIL", "TGD", "POL", "SOF")
out, df, A = E5.build(d, g, flags=FL)
o = out.copy(); o["cover"] = np.where(o["cover"] >= 0.45, 1.0, 0.0)
spx = d["SPX"].s.reindex(g).ffill(); sma = spx.rolling(200).mean(); below = (spx < sma * 0.98).values
WIN = (("2000-01-03","2026-12-31"),("2000-01-03","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01","2026-12-31"))
rows = []
for T1, T2, G, hy, cap in itertools.product((-12, -10, -8), (-34, -30, -26, -22), (-10, 0, 99), (3, 5), (0, 1)):
    expo, rung = E5.machine3(o, T1, T2, G, hy)
    if cap:   # trend cap: below 200d by >2% -> at most 50%
        expo = pd.Series(np.where(below, np.minimum(expo.values, 0.5), expo.values), index=g)
    r, e = r5.run(expo, g)
    row = dict(T1=T1, T2=T2, G=G, hy=hy, cap=cap)
    for i, (a, b) in enumerate(WIN):
        m = H.metrics(r[a:b], cash[a:b]); row[f"sh{i}"] = m["sharpe"]; row[f"cg{i}"] = m["cagr"] * 100; row[f"dd{i}"] = m["maxdd"] * 100
    row["tr"] = (e.diff().abs() > 1e-9).sum() / (len(r) / 252)
    rows.append(row)
R = pd.DataFrame(rows); pd.set_option("display.width", 250)
print(R.sort_values("sh0", ascending=False).head(12).round(2).to_string())
print(R[(R.T1 == -10) & (R.T2 == -30)].round(2).to_string())
print(R.groupby("cap")[["sh0", "sh1", "sh2", "sh3", "cg0", "dd0", "cg3"]].mean().round(2))
print(R.groupby("G")[["sh0", "sh1", "sh2", "sh3", "dd0"]].mean().round(2))
