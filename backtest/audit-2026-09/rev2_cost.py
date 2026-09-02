import sys, os, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L
from harness import metrics
d = L.load_all(); tr = d["SP500TR"].s; cash = d["DTB3"].s/100/252
for yr in ("2003", "1990"):
    s = pd.read_csv(f"out/rev2_series_{yr}.csv", index_col=0, parse_dates=True)
    trr = tr.pct_change().reindex(s.index).fillna(0.0); c = cash.reindex(s.index).ffill().fillna(0.0)
    for bps in (0, 10, 25, 50):
        row = []
        for k in ("e_base", "e_p1", "e_drop"):
            e = s[k]; turn = e.diff().abs().fillna(0.0); r = e*trr + (1-e)*c - turn*bps/1e4
            row.append(f"{k[2:]} Sh {metrics(r, c)['sharpe']:.3f}")
        print(f"{yr} cost {bps:2d} bp: " + " | ".join(row))
