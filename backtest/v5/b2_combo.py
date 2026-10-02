import numpy as np, pandas as pd
import r5, harness as H, eng5 as E5
exec(open("b1_flags.py").read().split("evalset((), \"LIVE\")")[0])
evalset((), "LIVE")
for fs in [("OIL","TGD"),("OIL","TGD","POL"),("OIL","TGD","POL","SOF"),("OIL","TGD","POL","SOF","LDW"),
           ("OIL","TGD","POL","SOF","LDW","RGC"),("OIL","TGD","POL","SOF","LDW","NFQ"),("OIL","TGD","POL","SOF","LDW","HYZ","SPZ"),
           ("OIL","TGD","POL","LDW")]:
    evalset(fs, "+".join(fs))
