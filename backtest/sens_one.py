# -*- coding: utf-8 -*-
"""Один прогон чувствительности в ИЗОЛИРОВАННОМ процессе: края нейтрали из argv."""
import sys, io, os, warnings, shutil, re
warnings.filterwarnings('ignore')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
lo, hi = float(sys.argv[1]), float(sys.argv[2])

# правим копию движка ДО импорта
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'engine.py'), encoding='utf-8').read()
if lo == hi:   # контроль: нейтрали нет вовсе
    src = src.replace('[r < 0.85, r < 0.97, r < 1.02, r < 1.05], [0, 1, 0, -1]',
                      '[r < 0.85, r < 1.0, r < 1.0, r < 1.05], [0, 1, 0, -1]')
else:
    src = src.replace('[r < 0.85, r < 0.97, r < 1.02, r < 1.05], [0, 1, 0, -1]',
                      '[r < 0.85, r < %s, r < %s, r < 1.05], [0, 1, 0, -1]' % (lo, hi))
tmp = os.path.join(here, '_sens_engine.py')
open(tmp, 'w', encoding='utf-8').write(src)
sys.path.insert(0, here)
import importlib.util
spec = importlib.util.spec_from_file_location('_sens_engine', tmp)
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)

import pandas as pd, numpy as np
EXPO = {"BUY":1.0,"HOLD+":0.85,"HOLD":0.65,"REDUCE":0.35,"PROTECT":0.0,"NA":0.65}
d = E.load_all(); spx = d["SPX"].s; tr = d["SP500TR"].s
grid = spx.loc["2004-01-01":].index; cash = (d["DTB3"].s/100/252).reindex(grid, method="ffill")
BASE = frozenset(["V1","V2","V4","V5","V7","V8"]) | {"VT","OH"}
df, A = E.build_scores(d, grid, era_fair=True, variants=BASE)
out = E.composite(df, A, variants=BASE); v = E.verdict_series(out)
idx = tr.loc["2006-01-01":"2026-07-01"].index
e = v.map(EXPO).reindex(idx).ffill().shift(1).fillna(.65)
rm = tr.pct_change().reindex(idx).fillna(0); rc = cash.reindex(idx).ffill().fillna(0)
r = e*rm + (1-e)*rc; eq = (1+r).cumprod()
ret = eq.pct_change().dropna(); vol = ret.std()*np.sqrt(252)
sh = (ret.mean()*252 - rc.mean()*252)/vol
cagr = eq.iloc[-1]**(1/((idx[-1]-idx[0]).days/365.25))-1
dd = (eq/eq.cummax()-1).min()
# сколько времени отношение проводит в нейтрали
vt = out["composite"]
print('%.2f %.2f %.4f %.4f %.4f' % (lo, hi, sh, cagr, dd))
os.remove(tmp)
