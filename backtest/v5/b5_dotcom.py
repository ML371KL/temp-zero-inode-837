import numpy as np, pandas as pd
import r5, harness as H, eng5 as E5
d = r5.data(); g = r5.grid("2000-01-03")
FL = ("OIL", "TGD", "POL", "SOF")
out, df, A = E5.build(d, g, flags=FL)
x = out["2000-01-01":"2002-12-31"]
print(x[["composite","lead","cover"]].resample("QE").mean().round(2).to_string())
print("cards present 2001-06:", df.loc["2001-06-01":"2001-06-05"].iloc[0].dropna().to_dict())
trr, cash = r5.returns(g)
WIN = (("2000-01-03","2026-12-31"),("2000-01-03","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01","2026-12-31"))
o2 = out.copy(); o2["cover"] = np.where(o2["cover"] >= 0.45, 1.0, 0.0)
for lab, o in (("NEW, cover>=0.45", o2),):
    expo, rung = E5.machine3(o, -10, -30, -10, 3)
    r, e = r5.run(expo, g); r5.stats(r, e, g, lab, windows=WIN)
    ch = rung["2000":"2002"]; ch = ch[ch.diff() != 0]
    print(" transitions 2000-02:", [(t.date(), int(v)) for t, v in ch.items()])
live, _, _ = E5.build(d, g, flags=()); l2 = live.copy(); l2["cover"] = np.where(l2["cover"] >= 0.45, 1.0, 0.0)
r, e = r5.run(H.ladder_machine(l2)[0], g); r5.stats(r, e, g, "v4.15 old 5-rung, cover>=0.45", windows=WIN)
