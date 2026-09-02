# -*- coding: utf-8 -*-
"""A2: leave-one-out ablation of indicators / families / blocks / detectors on the ladder strategy.
Metric deltas vs baseline for full 2003-2026 and two halves (2003-2014, 2015-2026) + 1998-2026 relaxed."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, metrics, RUNG_PCT

START = sys.argv[1] if len(sys.argv)>1 else "2003-01-01"
d = L.load_all()
spx=d["SPX"].s; tr=d["SP500TR"].s; cash=d["DTB3"].s/100/252
grid=spx.loc[START:].index
df, A = E.build_scores(d, grid)
trr=tr.pct_change().reindex(grid).fillna(0.0); cashr=cash.reindex(grid).ffill().fillna(0.0)

def hard_market(A, grid):
    hy=A.get("hy",pd.Series(np.nan,index=grid)); hymom=A.get("hy_mom",pd.Series(np.nan,index=grid))
    vix=A.get("vix",pd.Series(np.nan,index=grid)); rvol=A.get("ratevol",pd.Series(0.0,index=grid)); jpyu=A.get("jpy_unwind",pd.Series(0.0,index=grid))
    return (((hy>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vix>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))

HM = hard_market(A, grid)

def signal_from(dfx, Ax, drop_det=()):
    out=E.composite(dfx, Ax)
    if drop_det:
        # recompute detpts without some detectors by re-running composite pieces: simplest = subtract contributions
        pass
    sig=out.copy()
    fund=out["fund_fired"].astype(bool)
    sig["fund"]=fund; sig["override"]=(fund&(HM>=2)).astype(bool); sig["hardMarket"]=HM
    return sig

def run(sig, cost=10):
    e,_=ladder_machine(sig)
    r,ee=simulate(e,trr,cashr,cost_bps=cost)
    return r, ee

def met(r, lo=None, hi=None):
    rr=r.loc[lo:hi] if (lo or hi) else r
    cc=cashr.reindex(rr.index)
    m=metrics(rr,cc)
    return m

def line(name, r, base=None):
    s=f"{name:34}"
    for lo,hi in [(None,None),("2003-01-01","2014-12-31"),("2015-01-01",None)]:
        m=met(r,lo,hi)
        if base is not None:
            mb=met(base,lo,hi)
            s+=f" | ΔSh {m['sharpe']-mb['sharpe']:+.3f} ΔDD {(m['maxdd']-mb['maxdd'])*100:+.1f} ΔCAGR {(m['cagr']-mb['cagr'])*100:+.2f}"
        else:
            s+=f" | Sh {m['sharpe']:.3f} DD {m['maxdd']*100:.1f} CAGR {m['cagr']*100:.2f}"
    return s

base_sig=signal_from(df,A)
rb,eb=run(base_sig)
print("window", grid[0].date(), grid[-1].date(), " avg expo", round(eb.mean(),3))
print(line("BASELINE (as built)", rb))
rc,_=simulate(pd.Series(eb.mean(),index=grid),trr,cashr,cost_bps=0)
print(line("const matched exposure", rc))
rbh,_=simulate(pd.Series(1.0,index=grid),trr,cashr,cost_bps=0)
print(line("buy&hold", rbh))

print("\n=== A2.1 Leave-one-INDICATOR-out (deltas vs baseline; positive ΔSh = indicator was HURTING) ===")
res=[]
for k in df.columns:
    dfx=df.drop(columns=[k])
    sig=signal_from(dfx,A)
    r,_=run(sig)
    res.append((k,line(f"- {k}",r,rb), met(r)['sharpe']-met(rb)['sharpe'], met(r,"2003-01-01","2014-12-31")['sharpe']-met(rb,"2003-01-01","2014-12-31")['sharpe'], met(r,"2015-01-01")['sharpe']-met(rb,"2015-01-01")['sharpe']))
res.sort(key=lambda x:-x[2])
for k,l,a,b,c in res: print(l)
print("\nIndicators whose REMOVAL improves Sharpe in BOTH halves:", [k for k,l,a,b,c in res if b>0 and c>0])
print("Indicators whose removal hurts in BOTH halves (i.e. valuable):", [k for k,l,a,b,c in res if b<0 and c<0])

print("\n=== A2.2 Leave-one-BLOCK-out ===")
for b in E.W:
    ks=[k for k in df.columns if E.FAM[k][0]==b]
    sig=signal_from(df.drop(columns=ks),A); r,_=run(sig)
    print(line(f"- block {b} ({len(ks)} ind)",r,rb))

print("\n=== A2.3 Only-one-block (block alone drives composite) ===")
for b in E.W:
    ks=[k for k in df.columns if E.FAM[k][0]!=b]
    sig=signal_from(df.drop(columns=ks),A); r,_=run(sig)
    print(line(f"only block {b}",r,rb))

print("\n=== A2.4 Detectors ablation (zero out detector points) ===")
def sig_no_det(names):
    out=E.composite(df,A)
    pts=out["detpts"].copy()
    # recompute individual detector contributions to subtract
    sp=A.get("sofr_spread"); sp3=A.get("sofr_spread3"); srf_last=A.get("srf_last"); srf_days25=A.get("srf_days25"); srf_qtr=A.get("srf_qtr")
    contrib={}
    if sp is not None:
        f_sp=(sp>15)|(sp3>10); w_sp=sp>5
    else: f_sp=pd.Series(False,index=grid); w_sp=f_sp
    if srf_last is not None:
        f_srf=(srf_days25>=2)|((srf_last>25)&(srf_qtr<0.5)); w_srf=srf_last>5
    else: f_srf=pd.Series(False,index=grid); w_srf=f_srf
    ff=(f_sp.fillna(False)|f_srf.fillna(False)); fw=(w_sp.fillna(False)|w_srf.fillna(False))&~ff
    contrib["fund"]=pd.Series(np.where(ff,-10,np.where(fw,-3,0)),index=grid)
    wti=A.get("wti"); wchg=A.get("wti_chg30")
    if wti is not None:
        ohi=A.get("oil_hi",pd.Series(95.0,index=grid)); omid=A.get("oil_mid",pd.Series(85.0,index=grid))
        o_f=(wti>ohi)|(wchg>25); o_w=((wti>omid)|(wchg>15))&~o_f
        contrib["oil"]=pd.Series(np.where(o_f.fillna(False),-10,np.where(o_w.fillna(False),-4,0)),index=grid)
    cy=A.get("cpi_yoy"); cyp=A.get("cpi_yoy_prev"); wup=A.get("wage_up")
    if cy is not None:
        wu=wup.fillna(1.0) if wup is not None else pd.Series(1.0,index=grid)
        i_f=(cy>3.5)&(wu>0.5); i_w=(cy>3.2)&(cy>=cyp)&~i_f
        contrib["infl"]=pd.Series(np.where(i_f.fillna(False),-8,np.where(i_w.fillna(False),-3,0)),index=grid)
    g2c=A.get("dgs2_chg60"); hyv=A.get("hy"); vixv=A.get("vix"); rvol=A.get("ratevol")
    if g2c is not None and hyv is not None:
        vv=vixv if vixv is not None else pd.Series(99.0,index=grid); rv=rvol if rvol is not None else pd.Series(0.0,index=grid)
        panic=(g2c<=-50)&((hyv>=450)|(rv>10)); good=(g2c<=-50)&(hyv<400)&(vv<30)&~panic; watch=(g2c<=-30)&(hyv<420)&~good&~panic
        contrib["pivot"]=pd.Series(np.where(good.fillna(False),10,np.where(watch.fillna(False),4,0)),index=grid)
    for n in names: pts=pts-contrib[n]
    o2=out.copy(); o2["detpts"]=pts; o2["composite"]=(o2["comp_raw"]+pts).clip(-100,100)
    sig=o2; fund=out["fund_fired"].astype(bool)
    if "fund" in names: fund=pd.Series(False,index=grid)
    sig["fund"]=fund; sig["override"]=(fund&(HM>=2)).astype(bool); sig["hardMarket"]=HM
    return sig, contrib
for n in ["fund","oil","infl","pivot"]:
    sig,contrib=sig_no_det([n]); r,_=run(sig)
    print(line(f"- detector {n} (active {int((contrib[n]!=0).mean()*100)}% days)",r,rb))
sig,_=sig_no_det(["fund","oil","infl","pivot"]); r,_=run(sig)
print(line("- ALL detectors",r,rb))
# note: turn detector (V7) exists in the page but the replica engine has it only as variant V7
df7,A7=E.build_scores(d,grid,variants=frozenset(["V7"]))
out7=E.composite(df7,A7,variants=frozenset(["V7"])); sig7=out7.copy(); f7=out7["fund_fired"].astype(bool); sig7["fund"]=f7; sig7["override"]=(f7&(HM>=2)).astype(bool)
r7,_=run(sig7); print(line("+ turn detector (V7, as in page)",r7,rb))

print("\n=== A2.5 Gate ablation & lead/coin only ===")
from harness import rung_from
def ladder_custom(sig, gate=(10,-10)):
    e,_=ladder_machine(sig,gate=gate); r,_=simulate(e,trr,cashr,cost_bps=10); return r
print(line("no lead gate",ladder_custom(base_sig,gate=(-999,999)),rb))
s2=base_sig.copy(); s2["composite"]=base_sig["lead"]; print(line("composite := lead only",run(s2)[0],rb))
s3=base_sig.copy(); s3["composite"]=base_sig["coin"]; print(line("composite := coin only",run(s3)[0],rb))
s4=base_sig.copy(); s4["composite"]=base_sig["comp_raw"]; print(line("composite without detectors",run(s4)[0],rb))
