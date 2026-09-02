# -*- coding: utf-8 -*-
"""A16: on each Capital Flows public call date, what did OUR panel say (live-logic replica: composite, lead, ladder exposure),
and how did both fare over the next 21/63 trading days (SPX calls only)."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L
d=L.load_all(); tr=d["SP500TR"].s
S=pd.read_csv("out/signal_2003.csv",index_col=0,parse_dates=True)         # current-logic composite/lead (a1 _cur run)
X=pd.read_csv("out/a8_series_2003.csv",index_col=0,parse_dates=True)      # e_base = ladder exposure (live logic), e_p1
C=pd.read_csv("extdata/capitalflows/CALLS.csv"); C["date"]=pd.to_datetime(C["date"])
C=C[C.asset=="SPX"].copy()
rows=[]
for _,c in C.iterrows():
    t=c["date"]; i=tr.index.searchsorted(t)
    if i+64>=len(tr): continue
    p0=tr.iloc[i+1]  # next close
    r21=(tr.iloc[i+22]/p0-1)*100; r63=(tr.iloc[i+64]/p0-1)*100
    s=S.loc[:t].iloc[-1]; e=X["e_base"].loc[:t].iloc[-1]
    pan_dir= 1 if e>=0.85 else (-1 if e<=0.35 else 0)
    rows.append(dict(date=t.date(),cf_dir=int(c["direction"]),note=str(c["note"])[:38],composite=round(s["composite"],1),lead=round(s["lead"],1),panel_expo=e,panel_dir=pan_dir,
                     spx_r21=round(r21,1),spx_r63=round(r63,1),cf_right63=np.sign(r63)==c["direction"],panel_right63=(np.sign(r63)==pan_dir) if pan_dir!=0 else None))
R=pd.DataFrame(rows); pd.set_option("display.width",220)
print(R.to_string(index=False))
print("\nCF SPX calls: n=%d, right at 63d: %d (%.0f%%)"%(len(R),R.cf_right63.sum(),R.cf_right63.mean()*100))
pr=R[R.panel_dir!=0]; print("Panel directional (expo>=85%% or <=35%%) on those dates: n=%d, right at 63d: %d"%(len(pr),int(pr.panel_right63.astype(bool).sum())))
print("Panel neutral (65%%) on %d of %d dates"%((R.panel_dir==0).sum(),len(R)))
print("Agreement CF vs panel direction (where panel directional): %d of %d"%(((pr.cf_dir==pr.panel_dir)).sum(),len(pr)))
R.to_csv("out/a16.csv",index=False)
