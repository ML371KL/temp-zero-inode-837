"""B0: reproduce audit baseline (v4.13.9 replica) and the live v4.15.1 engine; old 5-rung vs naive 3-step."""
import numpy as np, pandas as pd
import r5, harness as H, eng5 as E5, loader as L

d = r5.data()
g = r5.grid("2003-01-01")
print("grid", g[0].date(), g[-1].date(), len(g))
print("cols: full 2003-2026 | 2003-14 | 2015-26")

# audit replica: CURRENT variants, era_fair False (as audited)
sig_a, df_a, A_a = H.build_signal(d, g, era_fair=False, variants=L.CURRENT, tag="audit")
expo, _ = H.ladder_machine(sig_a)
r, e = r5.run(expo, g); r5.stats(r, e, g, "AUDIT replica v4.13.9 ladder (exp 0.76)")

# live v4.15.1
out, df, A = E5.build(d, g, flags=())
expo, _ = H.ladder_machine(out)
r, e = r5.run(expo, g); r5.stats(r, e, g, "LIVE v4.15.1 5-rung machine")
r, e = r5.run(r5.bh(g), g); r5.stats(r, e, g, "Buy & hold")
for T1, T2 in [(-10, -30), (0, -30), (-5, -25), (5, -20)]:
    expo, _ = E5.machine3(out, T1=T1, T2=T2)
    r, e = r5.run(expo, g); r5.stats(r, e, g, f"LIVE 3-rung machine T1={T1} T2={T2}")
print(out[["composite", "lead", "coin", "detpts"]].describe().round(1))
print("last:", out.iloc[-1][["composite", "lead", "coin", "detpts"]].round(1).to_dict())
