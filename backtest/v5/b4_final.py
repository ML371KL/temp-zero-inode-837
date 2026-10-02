import numpy as np, pandas as pd
import r5, harness as H, eng5 as E5
d = r5.data()
FL = ("OIL", "TGD", "POL", "SOF")
for start in ("2000-01-03", "2003-01-01"):
    g = r5.grid(start); trr, cash = r5.returns(g)
    WIN = ((start, "2026-12-31"), ("2000-01-03", "2002-12-31"), ("2003-01-01", "2014-12-31"), ("2015-01-01", "2026-12-31"))
    out, df, A = E5.build(d, g, flags=FL)
    live, _, _ = E5.build(d, g, flags=())
    print(f"\n==== start {start} | cols: full | 2000-02 | 2003-14 | 2015-26 ====")
    def S(expo, lab):
        r, e = r5.run(expo, g); r5.stats(r, e, g, lab, windows=WIN); return r, e
    rN, eN = S(E5.machine3(out, -10, -30, -10, 3)[0], "NEW: v5 cards + 100/50/0 (-10/-30, G-10, h3)")
    S(E5.machine3(live, -10, -30, -10, 3)[0], "v4.15 cards + 100/50/0")
    S(H.ladder_machine(live)[0], "v4.15 cards + old 5-rung (as live)")
    S(r5.bh(g), "Buy & hold S&P TR")
    spx = d["SPX"].s.reindex(g).ffill(); sma = spx.rolling(200).mean()
    tf = pd.Series(np.where(spx > sma * 1.02, 1.0, np.where(spx < sma * 0.98, 0.0, np.nan)), index=g).ffill().fillna(1.0)
    S(tf, "Simple: 200d trend with ±2% band (1/0)")
    vol = trr.rolling(21).std() * np.sqrt(252); vt = (0.12 / vol).clip(upper=1.0).fillna(1.0)
    S(vt, "Simple: vol target 12%")
    s3 = pd.Series(np.select([out["composite"] >= -10, out["composite"] >= -30], [1.0, 0.5], 0.0), index=g)
    S(s3, "NEW verdict as-is (no machine)")
    # exposure profile
    if start == "2003-01-01":
        _, rung = E5.machine3(out, -10, -30, -10, 3)
        print("time in rungs:", (rung.value_counts(normalize=True).sort_index() * 100).round(1).to_dict())
        ch = rung[rung.diff() != 0].iloc[1:]
        print("transitions:", len(ch), "per year", round(len(ch) / (len(g) / 252), 2))
        for t, v in ch.items(): print("  ", t.date(), int(v), round(out["composite"][t], 1))
        print("now:", out.iloc[-1][["composite", "lead", "coin", "detpts"]].round(1).to_dict(), "rung", int(rung.iloc[-1]))
        print("blocks now:", out.iloc[-1][[c for c in out.columns if c.startswith("B_")]].round(1).to_dict())
