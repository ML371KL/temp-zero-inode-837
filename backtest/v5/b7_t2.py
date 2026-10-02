import numpy as np, pandas as pd
import r5, harness as H, eng5 as E5
d = r5.data(); g = r5.grid("2000-01-03"); trr, cash = r5.returns(g)
out, df, A = E5.build(d, g, flags=("OIL", "TGD", "POL", "SOF"))
o = out.copy(); o["cover"] = np.where(o["cover"] >= 0.45, 1.0, 0.0)
WIN = (("2000-01-03","2026-12-31"),("2000-01-03","2002-12-31"),("2003-01-01","2014-12-31"),("2015-01-01","2026-12-31"))
for T1 in (-12, -10):
    for T2 in range(-40, -19, 2):
        expo, rung = E5.machine3(o, T1, T2, -10, 3)
        r, e = r5.run(expo, g)
        s = []
        for a, b in WIN:
            m = H.metrics(r[a:b], cash[a:b]); s.append(f"{m['sharpe']:5.2f}/{m['cagr']*100:5.1f}/{m['maxdd']*100:5.1f}")
        print(T1, T2, " | ".join(s))
