import numpy as np, pandas as pd
import r5, eng5 as E5
d = r5.data()
px_all = d["SPX"].s
def ddrate(px):
    fm = pd.concat([px.shift(-k) for k in range(1, 64)], axis=1).min(axis=1)
    y = ((fm / px - 1) <= -0.10).astype(float); y[px.shift(-63).isna()] = np.nan; return y
for a in ("1950-01-01", "1990-01-01", "2000-01-01", "2003-01-01"):
    p = px_all[a:]; print("base DD10/63d since", a, round(ddrate(p).mean() * 100, 1))
g = r5.grid("2000-01-03")
out, df, A = E5.build(d, g, flags=("OIL", "TGD", "POL", "SOF"))
o = out.copy(); o = o[o["cover"] >= 0.45]
px = d["SPX"].s.reindex(g).ffill(); tr = d["SP500TR"].s.reindex(g).ffill()
f63 = (tr.shift(-63) / tr - 1) * 100 * 4
y = ddrate(px)
c, l = o["composite"], o["lead"]
reg = pd.Series(np.select([(c >= 30) & (l >= 10), c >= -10, (c >= -30) | (l > -10)], ["1 НИЗКИЙ", "2 УМЕРЕННЫЙ", "3 ПОВЫШЕН"], "4 КРИЗИС"), index=o.index)
for a, b in (("2000-01-01", "2026-12-31"), ("2003-01-01", "2026-12-31")):
    m = (reg.index >= a) & (reg.index <= b)
    t = pd.DataFrame({"share%": reg[m].value_counts(normalize=True) * 100, "fwd3m_ann%": f63.reindex(reg.index)[m].groupby(reg[m]).mean(),
                      "P(DD10)%": y.reindex(reg.index)[m].groupby(reg[m]).mean() * 100, "n": reg[m].value_counts()})
    print(a, b); print(t.sort_index().round(1))
