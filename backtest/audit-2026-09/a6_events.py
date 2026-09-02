# -*- coding: utf-8 -*-
"""A6: episode-level view. (1) every ladder downgrade/upgrade event with SPX drawdown-at-signal and
forward returns; (2) which detector carries predictive info; (3) replica vs live panel sanity check."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from scipy import stats
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
from harness import ladder_machine, simulate, RUNG_PCT

d=L.load_all(); spx=d["SPX"].s; tr=d["SP500TR"].s; cash=d["DTB3"].s/100/252
grid=spx.loc["2003-01-01":].index
df,A=E.build_scores(d,grid); out=E.composite(df,A)
hy=A.get("hy"); hymom=A.get("hy_mom"); vix=A.get("vix"); rvol=A.get("ratevol",pd.Series(0.0,index=grid)); jpyu=A.get("jpy_unwind",pd.Series(0.0,index=grid))
HM=(((hy>450)&(hymom>75)).astype(float).fillna(0)+(jpyu>0.5).astype(float).fillna(0)+(vix>35).astype(float).fillna(0)+(rvol>10).astype(float).fillna(0))
f=out["fund_fired"].astype(bool); out["fund"]=f; out["override"]=(f&(HM>=2)).astype(bool)
e,rung=ladder_machine(out)
p=spx.reindex(grid).ffill(); trg=tr.reindex(grid).ffill()
dd252=(p/p.rolling(252).max()-1)*100
fw=lambda h:(trg.shift(-h)/trg-1)*100
f1,f3,f6,f12=fw(21),fw(63),fw(126),fw(252)
# min forward drawdown over next 6m (max adverse excursion) and max forward gain
def mae(h):
    return pd.Series([ (trg.iloc[i+1:i+1+h].min()/trg.iloc[i]-1)*100 if i+1+h<=len(trg) else np.nan for i in range(len(trg))],index=grid)
mae6=mae(126)
ch=rung.diff().fillna(0)
ev=grid[ch!=0]
rows=[]
for t in ev:
    i=grid.get_loc(t)
    rows.append(dict(date=t.date(),from_=int(rung.iloc[i-1]),to=int(rung.iloc[i]),comp=round(out["composite"].iloc[i],1),lead=round(out["lead"].iloc[i],1),
                     dd_at_signal=round(dd252.iloc[i],1),fwd1m=round(f1.iloc[i],1),fwd3m=round(f3.iloc[i],1),fwd6m=round(f6.iloc[i],1),fwd12m=round(f12.iloc[i],1),mae6m=round(mae6.iloc[i],1)))
EV=pd.DataFrame(rows)
pd.set_option("display.width",250); pd.set_option("display.max_rows",400)
dn=EV[EV.to<EV.from_]; up=EV[EV.to>EV.from_]
print("=== A6.1 DOWNGRADE events (rung down), n=",len(dn))
print(dn.to_string(index=False))
print("\nDowngrades by drawdown-at-signal bucket: mean fwd3m / fwd6m / hit(fwd6m<0) / n")
for lo,hi in [(-100,-20),(-20,-10),(-10,-5),(-5,0.1)]:
    x=dn[(dn.dd_at_signal>lo)&(dn.dd_at_signal<=hi)]
    if len(x): print(f"  dd in ({lo},{hi}]: fwd3m {x.fwd3m.mean():+.1f}%  fwd6m {x.fwd6m.mean():+.1f}%  P(fwd6m<0) {(x.fwd6m<0).mean()*100:.0f}%  mae6m {x.mae6m.mean():+.1f}%  n={len(x)}")
print("\nDowngrades INTO rung 0 (PROTECT):"); print(dn[dn.to==0].to_string(index=False))
print("\n=== A6.2 UPGRADE events, n=",len(up))
for lo,hi in [(-100,-20),(-20,-10),(-10,-5),(-5,0.1)]:
    x=up[(up.dd_at_signal>lo)&(up.dd_at_signal<=hi)]
    if len(x): print(f"  dd in ({lo},{hi}]: fwd3m {x.fwd3m.mean():+.1f}%  fwd6m {x.fwd6m.mean():+.1f}%  n={len(x)}")
# time spent per rung inside deep drawdowns (>20%) vs recovery legs
deep=(dd252<-20)
print("\n=== A6.3 Exposure while SPX is >20% below its 1y high (post-crash phase): avg expo",round(e[deep].mean(),2),"days",int(deep.sum()))
print("   ... and while within 5% of the high:",round(e[dd252>-5].mean(),2))
# forward 12m return from days with deep drawdown, by rung
for r_ in range(5):
    m=deep&(rung==r_)
    if m.sum()>20: print(f"   rung {r_} ({RUNG_PCT[r_]*100:.0f}%) in deep-dd days: n={int(m.sum())} fwd12m {f12[m].mean():+.1f}%  fwd6m {f6[m].mean():+.1f}%")
# (2) detector decomposition IC
print("\n=== A6.4 Detector contributions: share of days active, IC vs fwd 3m/6m (weekly) ===")
trg2=trg; cashg=cash.reindex(grid).ffill().fillna(0)
fx3=np.log(trg.shift(-63)/trg)-cashg.rolling(63).sum().shift(-63); fx6=np.log(trg.shift(-126)/trg)-cashg.rolling(126).sum().shift(-126)
wk=grid[::5]
sp=A.get("sofr_spread"); sp3=A.get("sofr_spread3"); srf_last=A.get("srf_last"); srf_days25=A.get("srf_days25"); srf_qtr=A.get("srf_qtr")
contrib={}
if sp is not None:
    f_sp=(sp>15)|(sp3>10); w_sp=sp>5
else: f_sp=pd.Series(False,index=grid); w_sp=f_sp
if srf_last is not None:
    f_srf=(srf_days25>=2)|((srf_last>25)&(srf_qtr<0.5)); w_srf=srf_last>5
else: f_srf=pd.Series(False,index=grid); w_srf=f_srf
ff_=(f_sp.fillna(False)|f_srf.fillna(False)); fw_=(w_sp.fillna(False)|w_srf.fillna(False))&~ff_
contrib["fund"]=pd.Series(np.where(ff_,-10,np.where(fw_,-3,0)),index=grid)
wti=A.get("wti"); wchg=A.get("wti_chg30"); ohi=A.get("oil_hi",pd.Series(95.0,index=grid)); omid=A.get("oil_mid",pd.Series(85.0,index=grid))
o_f=(wti>ohi)|(wchg>25); o_w=((wti>omid)|(wchg>15))&~o_f
contrib["oil"]=pd.Series(np.where(o_f.fillna(False),-10,np.where(o_w.fillna(False),-4,0)),index=grid)
cy=A.get("cpi_yoy"); cyp=A.get("cpi_yoy_prev"); wup=A.get("wage_up"); wu=wup.fillna(1.0)
i_f=(cy>3.5)&(wu>0.5); i_w=(cy>3.2)&(cy>=cyp)&~i_f
contrib["infl"]=pd.Series(np.where(i_f.fillna(False),-8,np.where(i_w.fillna(False),-3,0)),index=grid)
g2c=A.get("dgs2_chg60"); hyv=A.get("hy"); vv=A.get("vix"); rv=rvol
panic=(g2c<=-50)&((hyv>=450)|(rv>10)); good=(g2c<=-50)&(hyv<400)&(vv<30)&~panic; watch=(g2c<=-30)&(hyv<420)&~good&~panic
contrib["pivot"]=pd.Series(np.where(good.fillna(False),10,np.where(watch.fillna(False),4,0)),index=grid)
for k,s in contrib.items():
    m3=pd.concat([s.reindex(wk),fx3.reindex(wk)],axis=1).dropna(); m6=pd.concat([s.reindex(wk),fx6.reindex(wk)],axis=1).dropna()
    act=(s!=0)
    line=f"  {k:6} active {act.mean()*100:4.1f}% days | IC3m {stats.spearmanr(m3.iloc[:,0],m3.iloc[:,1]).correlation:+.3f} IC6m {stats.spearmanr(m6.iloc[:,0],m6.iloc[:,1]).correlation:+.3f}"
    for val in sorted(s.unique()):
        if val==0: continue
        x=fx3[s==val].dropna()
        line+=f" | pts {val:+.0f}: fwd3m {x.mean()*4*100:+.1f}%/yr n={len(x)}"
    print(line)
# (3) replica vs live
print("\n=== A6.5 Replica (PIT engine) last 12 trading days: composite / lead / coin / rung ===")
tail=pd.DataFrame({"composite":out["composite"],"lead":out["lead"],"coin":out["coin"],"detpts":out["detpts"],"cover":out["cover"],"rung":rung}).tail(12).round(1)
print(tail.to_string())
print("last-day indicator scores:"); print(df.tail(1).T.dropna().astype(int).T.to_string())
EV.to_csv("out/a6_events.csv",index=False)
