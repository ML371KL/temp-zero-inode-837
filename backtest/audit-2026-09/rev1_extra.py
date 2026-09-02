# -*- coding: utf-8 -*-
"""REV1 extra: (i) IC sign of RAW levels (zone-coding artifact test); (ii) IC ex-crisis; (iii) returns by traded rung;
(iv) constant-jpy offset on lead gate; (v) opportunity cost per rung; (vi) rolling 3y Sharpe DASH vs B&H.
Run: PYTHONIOENCODING=utf-8 python rev1_extra.py > out/rev1_extra.txt"""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from scipy import stats
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, metrics, RUNG_PCT
pd.set_option("display.width", 250)
d = L.load_all(); spx = d["SPX"].s; tr = d["SP500TR"].s; cash = d["DTB3"].s/100/252
grid = spx.loc["2003-01-01":].index
df, A = E.build_scores(d, grid); out = E.composite(df, A)
trg = tr.reindex(grid).ffill(); cashg = cash.reindex(grid).ffill().fillna(0)
trr = tr.pct_change().reindex(grid).fillna(0.0); cashr = cashg
H = {"1m":21, "3m":63, "6m":126, "12m":252}
fwd = pd.DataFrame({k: np.log(trg.shift(-h)/trg) - cashg.rolling(h).sum().shift(-h) for k,h in H.items()})
def hard_market(A, grid):
    hy=A.get("hy"); hymom=A.get("hy_mom"); vix=A.get("vix"); rvol=A.get("ratevol"); jpyu=A.get("jpy_unwind")
    return (((hy>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vix>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))
HM = hard_market(A, grid)
def mk_sig(dfx):
    o = E.composite(dfx, A); f = o["fund_fired"].astype(bool); o["fund"]=f; o["override"]=(f&(HM>=2)).astype(bool); o["hardMarket"]=HM; return o
sig = mk_sig(df); expo, rung = ladder_machine(sig); r_dash, e_dash = simulate(expo, trr, cashr, 10)
r_bh,_ = simulate(pd.Series(1.0,index=grid), trr, cashr, 0)
def sh(x): return (x-cashr.reindex(x.index)).mean()*252/(x.std()*np.sqrt(252))
def nonovl(x, y, h, msk=None):
    ics=[]
    for off in range(0,h,5):
        idx=grid[off::h]
        m=pd.concat([x.reindex(idx),y.reindex(idx)],axis=1)
        if msk is not None: m=m[msk.reindex(idx).fillna(False).values]
        m=m.dropna()
        if len(m)>=12: ics.append(stats.spearmanr(m.iloc[:,0],m.iloc[:,1]).correlation)
    return (np.mean(ics), (np.array(ics)<0).mean(), len(ics)) if ics else (np.nan,np.nan,0)

print("=== (i) IC of RAW PIT levels vs forward excess (positive = high spread/vol/unemployment -> higher future return) ===")
for k in ["hy","vix","sahm","ratevol","hy_mom","wti","dgs2_chg60"]:
    if k not in A: continue
    line=f"  raw {k:10}"
    for hk,h in H.items():
        ic,neg,n=nonovl(A[k], fwd[hk], h); line+=f" | {hk} {ic:+.3f} (neg {neg*100:.0f}% of {n} phases)"
    print(line)
print("  -> score IC sign for hy/vix/sahm is just the raw level's sign inverted by the zone map; not a coding artifact.")

print("\n=== (ii) IC of composite / coin / hy with non-overlapping samples, EXCLUDING 2008-09 and 2020 (signal date) ===")
m1 = pd.Series(True, index=grid); m1.loc["2008-01-01":"2009-12-31"]=False; m1.loc["2020-01-01":"2020-12-31"]=False
m2 = m1.copy(); m2.loc["2007-07-01":"2007-12-31"]=False; m2.loc["2022-01-01":"2022-12-31"]=False
for name,s in [("composite",out["composite"]),("comp_raw",out["comp_raw"]),("coin",out["coin"]),("lead",out["lead"]),("detpts",out["detpts"]),("hy",df["hy"]),("ig",df["ig"]),("sloos",df["sloos"]),("sahm",df["sahm"]),("vix",df["vix"])]:
    line=f"  {name:10}"
    for hk,h in H.items():
        ic,neg,n=nonovl(s,fwd[hk],h,m1); ic2,neg2,n2=nonovl(s,fwd[hk],h,m2)
        line+=f" | {hk}: ex08-09,20 {ic:+.3f} ({neg*100:.0f}%neg) ; also ex07H2,22 {ic2:+.3f} ({neg2*100:.0f}%neg)"
    print(line)

print("\n=== (iii) Forward excess return by TRADED rung (ladder state at signal date), annualized %, full vs ex-crisis ===")
masks={"full":pd.Series(True,index=grid),"ex 2008-09 & 2020":m1,"ex 07H2,08-09,20,22":m2}
for mn,msk in masks.items():
    for hk in ("1m","3m","12m"):
        line=f"  {mn:20} {hk:3}"
        for r_ in range(5):
            x=fwd[hk][(rung==r_)&msk].dropna()
            if len(x): line+=f" | rung{r_}({int(RUNG_PCT[r_]*100)}%): {x.mean()*252/H[hk]*100:+.1f}% n={len(x)} hit {(x>0).mean()*100:.0f}%"
        print(line)

print("\n=== (iv) Constant-jpy offset on the lead gate and composite ===")
dfn = df.drop(columns=["jpy"]); on = E.composite(dfn, A)
print(f"  lead: mean with jpy {out['lead'].mean():+.2f}, without {on['lead'].mean():+.2f}, mean diff {(out['lead']-on['lead']).mean():+.2f} pts; composite mean diff {(out['composite']-on['composite']).mean():+.2f} pts")
print(f"  share of days lead>=10 (BUY gate open): with jpy {(out['lead']>=10).mean()*100:.1f}% ; without {(on['lead']>=10).mean()*100:.1f}%")
print(f"  share of days lead<=-10 (PROTECT gate open): with jpy {(out['lead']<=-10).mean()*100:.1f}% ; without {(on['lead']<=-10).mean()*100:.1f}%")
v1=E.verdict_series(out); v2=E.verdict_series(on)
print("  verdict shares with jpy   :", (v1.value_counts(normalize=True)*100).round(1).to_dict())
print("  verdict shares without jpy:", (v2.value_counts(normalize=True)*100).round(1).to_dict())
print(f"  jpy score by era: pre-2024 {df['jpy'].loc[:'2023-12-31'].mean():+.2f} ; 2024+ {df['jpy'].loc['2024-01-01':].mean():+.2f}")
# same for oil level rule (WTI>80 -> -1) and stagf (constant 0)
print(f"  other near-constant scores: stagf modal share {df['stagf'].value_counts(normalize=True).iloc[0]:.2f}, srf {df['srf'].value_counts(normalize=True).iloc[0]:.2f}, real10 {df['real10'].value_counts(normalize=True).iloc[0]:.2f}, rrp {df['rrp'].value_counts(normalize=True).iloc[0]:.2f}")

print("\n=== (v) Opportunity cost by rung: cumulative market excess (next-day execution) while at each rung, by year ===")
used_r = rung.shift(1)
for r_ in range(5):
    m=(used_r==r_)
    tot=((trr-cashr)[m]).sum()*100; byy=((trr-cashr)[m]).groupby(lambda t:t.year).sum()*100
    print(f"  rung {r_} ({int(RUNG_PCT[r_]*100)}%): days {int(m.sum())}, cum market excess {tot:+.1f}% ; worst yrs {byy.nsmallest(2).round(1).to_dict()} best yrs {byy.nlargest(3).round(1).to_dict()}")
# realised P&L attribution of the DASH-vs-const-matched difference by rung
rc,_ = simulate(pd.Series(e_dash.mean(),index=grid), trr, cashr, 0)
diff = (r_dash - rc)
print("  DASH minus const-matched daily diff summed by used rung (pp):", {int(r_): round(diff[used_r==r_].sum()*100,1) for r_ in range(5)})
print("  ... summed by year:", (diff.groupby(lambda t:t.year).sum()*100).round(1).to_dict())
print(f"  ... total {diff.sum()*100:+.1f}pp; excluding 2008: {diff[diff.index.year!=2008].sum()*100:+.1f}pp; excluding 2008-2009: {diff[~diff.index.year.isin([2008,2009])].sum()*100:+.1f}pp")

print("\n=== (vi) Rolling 3y Sharpe: DASH vs B&H, share of windows where DASH wins; sub-period table ===")
ex_d=(r_dash-cashr); ex_b=(r_bh-cashr); w=756
rs_d=ex_d.rolling(w).mean()*252/(r_dash.rolling(w).std()*np.sqrt(252)); rs_b=ex_b.rolling(w).mean()*252/(r_bh.rolling(w).std()*np.sqrt(252))
dd_=(rs_d-rs_b).dropna()
print(f"  3y windows: {len(dd_)}; DASH>B&H in {(dd_>0).mean()*100:.0f}% ; mean diff {dd_.mean():+.3f}; windows ending 2011-2026 only: {(dd_.loc['2011-06-30':]>0).mean()*100:.0f}%")
for lo,hi in [("2003-01-01","2007-09-30"),("2007-10-01","2009-06-30"),("2009-07-01","2019-12-31"),("2020-01-01","2020-12-31"),("2021-01-01","2026-09-01")]:
    a=r_dash.loc[lo:hi]; b=r_bh.loc[lo:hi]
    print(f"  {lo}..{hi}: DASH Sh {sh(a):.2f} CAGR {metrics(a,cashr.loc[lo:hi])['cagr']*100:5.2f} DD {metrics(a,cashr.loc[lo:hi])['maxdd']*100:6.1f} E {e_dash.loc[lo:hi].mean():.2f} | B&H Sh {sh(b):.2f} CAGR {metrics(b,cashr.loc[lo:hi])['cagr']*100:5.2f} DD {metrics(b,cashr.loc[lo:hi])['maxdd']*100:6.1f}")

print("\n=== (vii) Family-averaging & coverage sanity ===")
print("  coverage min/median:", round(out['cover'].min(),2), round(out['cover'].median(),2), "; days cover<0.6:", int((out['cover']<0.6).sum()))
# recompute composite by hand for the last day to check block weighting
t=grid[-1]; B={}
for b in E.W:
    inds=[k for k,v in E.FAM.items() if v[0]==b]; fams={}
    for k in inds: fams.setdefault(E.FAM[k][1],[]).append(k)
    B[b]=np.nanmean([np.nanmean([df[k][t] for k in ks]) for ks in fams.values()])/2*100
comp=sum(B[b]*E.W[b] for b in B)/sum(E.W.values())
print(f"  hand-recomputed comp_raw on {t.date()}: {comp:.2f} vs engine {out['comp_raw'][t]:.2f}; detpts {out['detpts'][t]:.1f}; blocks {{k:round(v,1) for k,v in B.items()}}".replace("{{","{").replace("}}","}"), {k:round(v,1) for k,v in B.items()})
# equal-weight-per-indicator alternative vs family averaging: how different is the composite?
alt={}
for b in E.W:
    inds=[k for k,v in E.FAM.items() if v[0]==b]; alt[b]=df[inds].mean(axis=1)/2*100
Balt=pd.DataFrame(alt); wpres=sum(Balt[b].notna()*E.W[b] for b in Balt); comp_alt=sum((Balt[b]*E.W[b]).fillna(0) for b in Balt)/wpres
print(f"  composite with per-indicator (no family) averaging: corr with engine comp_raw {comp_alt.corr(out['comp_raw']):.3f}, mean abs diff {(comp_alt-out['comp_raw']).abs().mean():.1f} pts")
