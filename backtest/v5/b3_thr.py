import itertools, numpy as np, pandas as pd
import r5, harness as H, eng5 as E5
d = r5.data(); g = r5.grid("2003-01-01"); trr, cash = r5.returns(g)
FL = ("OIL", "TGD", "POL", "SOF")
out, df, A = E5.build(d, g, flags=FL)
W1, W2 = ("2003-01-01", "2014-12-31"), ("2015-01-01", "2026-12-31")
rows = []
for T1, T2, G, hy, fz in itertools.product(range(-20, 6, 2), range(-46, -14, 4), (-20, -10, 0, 99), (0, 3, 5), (0, 1)):
    if T2 >= T1: continue
    expo, rung = E5.machine3(out, T1=T1, T2=T2, G=G, hyst=hy, fired=out["fund"].values if fz else None)
    r, e = r5.run(expo, g)
    m = H.metrics(r, cash); m1 = H.metrics(r[W1[0]:W1[1]], cash[W1[0]:W1[1]]); m2 = H.metrics(r[W2[0]:W2[1]], cash[W2[0]:W2[1]])
    tr = (e.diff().abs() > 1e-9).sum() / (len(r) / 252)
    rows.append(dict(T1=T1, T2=T2, G=G, hy=hy, fz=fz, sh=m["sharpe"], cagr=m["cagr"], dd=m["maxdd"], sh1=m1["sharpe"], sh2=m2["sharpe"], cagr1=m1["cagr"], cagr2=m2["cagr"], dd1=m1["maxdd"], dd2=m2["maxdd"], tr=tr, ex=e.mean()))
R = pd.DataFrame(rows); R.to_pickle("cache5/b3.pkl")
pd.set_option("display.width", 250)
print(R.sort_values("sh", ascending=False).head(15).round(3).to_string())
# walk-forward: best on half 1 -> score on half 2, and vice versa
b1 = R.loc[R.sh1.idxmax()]; b2 = R.loc[R.sh2.idxmax()]
print("best on 2003-14:", b1[["T1","T2","G","hy","fz","sh1"]].to_dict(), "-> 2015-26 Sh", round(b1.sh2,3), "rank", int((R.sh2 > b1.sh2).sum()), "/", len(R))
print("best on 2015-26:", b2[["T1","T2","G","hy","fz","sh2"]].to_dict(), "-> 2003-14 Sh", round(b2.sh1,3), "rank", int((R.sh1 > b2.sh1).sum()), "/", len(R))
# smoothness: average over T1±2, T2±4 neighbourhood for hy=3, fz=1, G=-10
sub = R[(R.hy == 3) & (R.fz == 1) & (R.G == -10)].pivot_table(index="T1", columns="T2", values="sh")
print(sub.round(3).to_string())
sub = R[(R.hy == 3) & (R.fz == 1) & (R.G == -10)].pivot_table(index="T1", columns="T2", values="cagr")
print((sub*100).round(2).to_string())
sub = R[(R.hy == 3) & (R.fz == 1) & (R.G == -10)].pivot_table(index="T1", columns="T2", values="dd")
print((sub*100).round(1).to_string())
print(R.groupby("G")[["sh","sh1","sh2","dd"]].mean().round(3)); print(R.groupby("hy")[["sh","sh1","sh2","tr"]].mean().round(3)); print(R.groupby("fz")[["sh","sh1","sh2"]].mean().round(3))
