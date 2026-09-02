# -*- coding: utf-8 -*-
"""A1: per-indicator predictive value (PIT-lagged scores from the engine replica) vs forward
S&P 500 total-return excess returns; zone monotonicity; composite/block IC; verdict distribution.
Sampling: weekly (every 5th trading day) to reduce overlap; block bootstrap for CI."""
import sys, os, json, warnings
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from scipy import stats
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L
import engine as E

START = sys.argv[1] if len(sys.argv)>1 else "1990-01-01"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),"out"); os.makedirs(OUT,exist_ok=True)

d = L.load_all()
spx = d["SPX"].s; tr = d["SP500TR"].s; cash = d["DTB3"].s/100/252
grid = spx.loc[START:].index
df, A = E.build_scores(d, grid)
out = E.composite(df, A)
# forward excess log returns (trading-day horizons)
trg = tr.reindex(grid).ffill()
cashg = cash.reindex(grid).ffill().fillna(0)
H = {"1m":21,"3m":63,"6m":126,"12m":252}
fwd = {}
for k,h in H.items():
    r = np.log(trg.shift(-h)/trg)
    c = cashg.rolling(h).sum().shift(-h)
    fwd[k] = (r - c)
fwd = pd.DataFrame(fwd)
rec = None
try:
    usrec = L.fred("USRECD") if os.path.exists(os.path.join(L.DATA,"USRECD.csv")) else L.fred("USREC")
    rec = usrec.reindex(grid, method="ffill").fillna(0)
except Exception as e:
    print("no USREC", e)

wk = grid[::5]   # weekly sampling

def block_boot_ic(x, y, nb=1000, bl=13, seed=0):
    """Spearman IC with moving-block bootstrap CI on weekly samples (block=13 weeks ~ 1 quarter)."""
    m = pd.concat([x,y],axis=1).dropna()
    if len(m) < 60: return np.nan, np.nan, np.nan, len(m)
    ic = stats.spearmanr(m.iloc[:,0], m.iloc[:,1]).correlation
    rng = np.random.default_rng(seed); n=len(m); nblk=int(np.ceil(n/bl)); ics=[]
    xv=m.iloc[:,0].values; yv=m.iloc[:,1].values
    for _ in range(nb):
        st = rng.integers(0, n-bl, nblk)
        idx = np.concatenate([np.arange(s,s+bl) for s in st])[:n]
        ics.append(stats.spearmanr(xv[idx], yv[idx]).correlation)
    lo, hi = np.percentile(ics,[2.5,97.5])
    return ic, lo, hi, n

rows=[]
zone_rows=[]
for k in df.columns:
    s = df[k]
    cov = s.notna().mean()
    first = s.dropna().index[0].date() if s.notna().any() else None
    rec_ = {"ind":k,"cover":round(cov,2),"first":str(first)}
    for hk in H:
        ic, lo, hi, n = block_boot_ic(s.reindex(wk), fwd[hk].reindex(wk))
        rec_[f"ic_{hk}"]=ic; rec_[f"lo_{hk}"]=lo; rec_[f"hi_{hk}"]=hi
    # zone conditional forward 3m/12m (annualized %)
    for z in sorted(s.dropna().unique()):
        msk = (s==z)
        for hk in ("3m","12m"):
            v = fwd[hk][msk].dropna()
            ann = v.mean()*252/H[hk]*100
            zone_rows.append({"ind":k,"zone":z,"h":hk,"n_days":int(msk.sum()),"fwd_ann":ann,
                              "hit":(v>0).mean() if len(v) else np.nan})
    # monotonicity: Spearman between zone value and mean fwd 3m by zone
    zr = [r for r in zone_rows if r["ind"]==k and r["h"]=="3m" and r["n_days"]>=60]
    if len(zr)>=3:
        rec_["mono_3m"] = stats.spearmanr([r["zone"] for r in zr],[r["fwd_ann"] for r in zr]).correlation
    else:
        rec_["mono_3m"] = np.nan
    rows.append(rec_)
res = pd.DataFrame(rows).set_index("ind")
pd.set_option("display.width",250); pd.set_option("display.max_columns",30)
print("=== A1.1 Per-indicator Spearman IC (score -> forward excess return), weekly samples, block-bootstrap 95% CI ===")
print(f"window {grid[0].date()}..{grid[-1].date()}")
cols=["cover","first"]+[c for hk in H for c in (f"ic_{hk}",)]+["mono_3m"]
print(res[cols].round(3).to_string())
sig=[]
for k in res.index:
    for hk in H:
        lo,hi=res.loc[k,f"lo_{hk}"],res.loc[k,f"hi_{hk}"]
        if lo==lo and (lo>0 or hi<0): sig.append((k,hk,round(res.loc[k,f"ic_{hk}"],3),round(lo,3),round(hi,3)))
print("\nCI excludes zero:",sig)

print("\n=== A1.2 Forward 3m excess return (annualized %) by zone score, n_days ===")
zdf=pd.DataFrame(zone_rows)
piv=zdf[zdf.h=="3m"].pivot(index="ind",columns="zone",values="fwd_ann").round(1)
pivn=zdf[zdf.h=="3m"].pivot(index="ind",columns="zone",values="n_days")
print(piv.to_string()); print("\nn_days:"); print(pivn.to_string())
print("\n=== A1.2b Forward 12m excess return (annualized %) by zone ===")
print(zdf[zdf.h=="12m"].pivot(index="ind",columns="zone",values="fwd_ann").round(1).to_string())

# composite / blocks / lead / coin
print("\n=== A1.3 Composite, lead, coin, blocks: IC by horizon ===")
W=E.W; FAM=E.FAM
blk={}
for b in W:
    inds=[k for k,v in FAM.items() if v[0]==b and k in df.columns]
    fams={}
    for k in inds: fams.setdefault(FAM[k][1],[]).append(k)
    fm=pd.concat([df[ks].mean(axis=1) for ks in fams.values()],axis=1)
    blk[b]=fm.mean(axis=1)/2*100
B=pd.DataFrame(blk)
agg={"composite":out["composite"],"comp_raw":out["comp_raw"],"lead":out["lead"],"coin":out["coin"],"detpts":out["detpts"]}
agg.update({f"block_{b}":B[b] for b in B})
for name,s in agg.items():
    line=f"{name:16}"
    for hk in H:
        ic,lo,hi,n=block_boot_ic(s.reindex(wk), fwd[hk].reindex(wk))
        line+=f"  {hk}: {ic:+.3f} [{lo:+.3f},{hi:+.3f}]"
    print(line)

# composite distribution and verdict frequencies
print("\n=== A1.4 Composite distribution ===")
c=out["composite"]; cv=out["cover"]
ok=c[cv>=0.6]
print("coverage>=0.6 from", ok.index[0].date(), "; pct of days with cover>=0.6:", round((cv>=0.6).mean(),3))
print("percentiles:", ok.quantile([.05,.1,.25,.5,.75,.9,.95]).round(1).to_dict())
v=E.verdict_series(out)
print("verdict share:", (v.value_counts(normalize=True)*100).round(1).to_dict())
if rec is not None:
    print("composite median in NBER expansion:", round(ok[rec.reindex(ok.index)==0].median(),1), " in recession:", round(ok[rec.reindex(ok.index)==1].median(),1))
    print("verdict share in recession:", (v[rec==1].value_counts(normalize=True)*100).round(1).to_dict())
# forward return by verdict
print("\n=== A1.5 Forward excess return by verdict (annualized %), and hit rate ===")
for hk in ("1m","3m","12m"):
    line=f"{hk:4}"
    for vv in ["PROTECT","REDUCE","HOLD","HOLD+","BUY"]:
        x=fwd[hk][v==vv].dropna()
        if len(x): line+=f"  {vv}: {x.mean()*252/H[hk]*100:+.1f}% (n={len(x)}, hit {(x>0).mean()*100:.0f}%)"
    print(line)
# event study: first crossing below -10 / -30 and above +30
print("\n=== A1.6 Event study: composite crossings (forward excess, %, not annualized) ===")
def crossings(s, thr, down=True):
    prev=s.shift(1)
    ev=(s<thr)&(prev>=thr) if down else (s>thr)&(prev<=thr)
    ev=ev&(cv>=0.6)
    return s.index[ev.fillna(False)]
for thr,down in [(-10,True),(-30,True),(10,False),(30,False)]:
    idx=crossings(c,thr,down)
    # de-cluster: keep first in 63-day window
    keep=[];last=None
    for t in idx:
        if last is None or (t-last).days>63: keep.append(t); last=t
    line=f"cross {'below' if down else 'above'} {thr:+d}: n={len(keep):3}"
    for hk in ("1m","3m","6m","12m"):
        x=fwd[hk].reindex(keep).dropna()
        line+=f" | {hk} {x.mean()*100:+.1f}% (hit {(x>0).mean()*100:.0f}%)"
    print(line)
    if thr==-30 and down: print("   dates:", [t.date().isoformat() for t in keep])
res.to_csv(os.path.join(OUT,f"a1_ic_{START[:4]}.csv")); zdf.to_csv(os.path.join(OUT,f"a1_zones_{START[:4]}.csv"),index=False)
out.to_csv(os.path.join(OUT,f"signal_{START[:4]}.csv")); df.to_csv(os.path.join(OUT,f"scores_{START[:4]}.csv"))
print("\nsaved to out/")
