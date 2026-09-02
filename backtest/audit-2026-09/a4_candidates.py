# -*- coding: utf-8 -*-
"""A4: screen candidate NEW indicators: PIT-lagged transforms -> Spearman IC vs forward excess returns
(weekly samples, block bootstrap CI), quintile spread, both halves."""
import sys, os, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from scipy import stats
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader as L, engine as E
EXT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"extdata")
START=sys.argv[1] if len(sys.argv)>1 else "1990-01-01"
d=L.load_all(); spx=d["SPX"].s; tr=d["SP500TR"].s; cash=d["DTB3"].s/100/252
grid=spx.loc[START:].index
trg=tr.reindex(grid).ffill(); cashg=cash.reindex(grid).ffill().fillna(0)
H={"1m":21,"3m":63,"6m":126,"12m":252}
fwd=pd.DataFrame({k:np.log(trg.shift(-h)/trg)-cashg.rolling(h).sum().shift(-h) for k,h in H.items()})
wk=grid[::5]

def F(name):
    try: return L.fred(name)
    except Exception: return None
def ext(name):
    p=os.path.join(EXT,name+".csv")
    if not os.path.exists(p): return None
    df=pd.read_csv(p); df=df.iloc[:,:2]; df.columns=["date","v"]; df["date"]=pd.to_datetime(df["date"]); df["v"]=pd.to_numeric(df["v"],errors="coerce")
    return df.dropna().set_index("date")["v"].sort_index()
def Y(name):
    try: return L.yahoo(name)
    except Exception: return None
def lag(s,days): return pd.Series(s.values,index=s.index+pd.Timedelta(days=days)).sort_index()
def ong(s): s=s[~s.index.duplicated(keep="last")]; return s.reindex(s.index.union(grid)).ffill().reindex(grid)
def yoy(s,periods=12): return (s/s.shift(periods)-1)*100
def chg(s,periods): return s-s.shift(periods)
def zs(s,win): return (s-s.rolling(win).mean())/s.rolling(win).std()
def rel63(a,b):
    r_=np.log(a)-np.log(b.reindex(a.index,method="ffill")); return r_-r_.shift(63)

C={}
def add(name,series,block,sign): C[name]=(series,block,sign)
# --- labor ---
icsa=F("ICSA")
if icsa is not None:
    c4=icsa.rolling(4).mean(); add("ICSA 4wk vs 26wk avg (%)",ong(lag((c4/c4.rolling(26).mean()-1)*100,5)),"macro",-1)
ccsa=F("CCSA")
if ccsa is not None: add("CCSA vs 26wk avg (%) [existing]",ong(lag((ccsa/ccsa.rolling(26).mean()-1)*100,12)),"macro",-1)
temp=F("TEMPHELPS")
if temp is not None: add("Temp help yoy %",ong(lag(yoy(temp),35)),"macro",1)
un=F("UNRATE")
if un is not None:
    add("UNRATE 3m chg",ong(lag(chg(un,3),35)),"macro",-1)
    add("UNRATE 3mavg vs 12m min (Sahm raw)",ong(lag(un.rolling(3).mean()-un.rolling(3).mean().rolling(12).min(),35)),"macro",-1)
quits=F("JTSQUR")
if quits is not None: add("JOLTS quits rate 3m chg",ong(lag(chg(quits,3),40)),"macro",1)
awh=F("AWHMAN")
if awh is not None: add("Avg weekly hours mfg 3m chg",ong(lag(chg(awh,3),35)),"macro",1)
pay=F("PAYEMS")
if pay is not None: add("Payrolls 3m avg chg (k) [existing raw]",ong(lag(pay.diff().rolling(3).mean(),35)),"macro",1)
# --- activity/surveys ---
for nm,lab,lg,avg in [("GACDFSA066MSFRBPHI","Philly Fed GA (3m avg)",20,3),("GACDISA066MSFRBNY","Empire State GA (3m avg)",15,3),("NOCDFSA066MSFRBPHI","Philly Fed new orders 3m",20,3),("CFNAI","CFNAI 3m avg",25,3),("BSCICP03USM665S","OECD business conf USA",40,1),("CSCICP03USM665S","OECD consumer conf USA",40,1),("UMCSENT","UMich sentiment",5,1),("USALOLITOAASTSAM","OECD CLI amp-adj USA level",40,1)]:
    s=F(nm)
    if s is not None:
        ss=s.rolling(avg).mean() if avg>1 else s
        add(lab,ong(lag(ss,lg)),"macro",1)
        if "CLI" in lab: add("OECD CLI 3m chg",ong(lag(chg(s,3),40)),"macro",1)
        if "UMich" in lab: add("UMich sentiment 6m chg",ong(lag(chg(s,6),5)),"macro",1)
cli=ext("oecd_cli_usa")
if cli is not None: add("OECD CLI (ext) 3m chg",ong(lag(chg(cli,3),40)),"macro",1)
perm=F("PERMIT")
if perm is not None: add("Permits yoy %",ong(lag(yoy(perm),20)),"macro",1)
newo=F("NEWORDER")
if newo is not None: add("Core capital goods orders yoy %",ong(lag(yoy(newo),35)),"macro",1)
indp=F("INDPRO")
if indp is not None: add("INDPRO 3m ann %",ong(lag(yoy(indp,3)*4,17)),"macro",1)
# --- rates / policy ---
t102=F("T10Y2Y")
if t102 is not None: add("10y-2y level",ong(lag(t102,1)),"macro",1)
t103=F("T10Y3M")
if t103 is not None: add("10y-3m level [existing raw]",ong(lag(t103,1)),"macro",1)
g2=F("DGS2"); ff=F("DFF")
if g2 is not None and ff is not None:
    add("2y minus FedFunds (policy exp.)",ong(lag(g2-ff.reindex(g2.index,method="ffill"),1)),"macro",1)
    add("2y 60d chg (bp)",ong(lag(chg(g2,42)*100,1)),"macro",-1)
g10=F("DGS10")
if g10 is not None: add("10y 3m chg (bp)",ong(lag(chg(g10,63)*100,1)),"macro",-1)
cpi=F("CPIAUCSL")
if ff is not None and cpi is not None:
    ffm=ff.resample("MS").mean(); rff=ffm-yoy(cpi).reindex(ffm.index)
    add("Real Fed funds (FF - CPI yoy)",ong(lag(rff,43)),"macro",-1)
m2=F("M2REAL")
if m2 is not None: add("Real M2 yoy %",ong(lag(yoy(m2),40)),"plumb",1)
bl=F("BUSLOANS")
if bl is not None: add("C&I loans yoy %",ong(lag(yoy(bl),10)),"credit",1)
# --- financial conditions / stress ---
for nm,lab,lg,sg,avg in [("STLFSI4","St Louis FSI",5,-1,1),("KCFSI","Kansas City FSI",35,-1,1),("ANFCI","ANFCI",5,-1,1),("NFCI","NFCI [existing raw]",5,-1,1),("NFCIRISK","NFCI risk sub",5,-1,1),("NFCILEVERAGE","NFCI leverage sub",5,-1,1),("NFCICREDIT","NFCI credit sub",5,-1,1),("NFCINONFINLEVERAGE","NFCI nonfin leverage",5,-1,1),("WLEMUINDXD","Econ policy uncertainty 21d avg",1,-1,21)]:
    s=F(nm)
    if s is not None:
        ss=s.rolling(avg).mean() if avg>1 else s
        add(lab,ong(lag(ss,lg)),"plumb",sg)
# --- credit ---
baa=F("BAA10Y"); aaa=F("AAA10Y")
if baa is not None:
    add("Baa-10y spread level",ong(lag(baa,1)),"credit",-1); add("Baa-10y 30d chg",ong(lag(chg(baa,21),1)),"credit",-1)
    if aaa is not None: add("Baa-Aaa spread",ong(lag(baa-aaa,1)),"credit",-1)
hy=d["BAMLH0A0HYM2"].s
add("HY OAS level [existing raw]",ong(lag(hy,1)),"credit",-1)
p30=hy.reindex(hy.index-pd.Timedelta(days=30),method="ffill"); p30.index=hy.index
add("HY OAS 30d chg [existing raw]",ong(lag(hy-p30,1)),"credit",-1)
add("HY OAS z vs 12m",ong(lag(zs(hy,252),1)),"credit",-1)
ig=d["BAMLC0A0CM"].s; p30i=ig.reindex(ig.index-pd.Timedelta(days=30),method="ffill"); p30i.index=ig.index
add("IG OAS 30d chg (missing in panel)",ong(lag(ig-p30i,1)),"credit",-1)
em=F("BAMLEMCBPIOAS")
if em is not None: add("EM corp OAS 30d chg (3y only)",ong(lag(chg(em,21),1)),"credit",-1)
hyg=Y("HYG"); tlt=Y("TLT")
if hyg is not None and tlt is not None: add("HYG/TLT 63d rel",ong(lag(rel63(hyg,tlt),1)),"credit",1)
# --- equity market internals ---
add("SPX 12-1 momentum %",ong(lag((spx.shift(21)/spx.shift(252)-1)*100,1)),"market",1)
add("SPX dist to 200DMA % [existing raw]",ong(lag((spx/spx.rolling(200).mean()-1)*100,1)),"market",1)
add("SPX 20d return % [existing raw]",ong(lag((spx/spx.shift(20)-1)*100,1)),"market",1)
add("SPX drawdown from 252d high %",ong(lag((spx/spx.rolling(252).max()-1)*100,1)),"market",1)
rv=np.log(spx).diff().rolling(21).std()*np.sqrt(252)*100
add("SPX realized vol 21d",ong(lag(rv,1)),"market",-1)
add("SPX rvol 21d / 252d ratio",ong(lag(rv/(np.log(spx).diff().rolling(252).std()*np.sqrt(252)*100),1)),"market",-1)
vix=d["VIXCLS"].s; add("VIX level [existing raw]",ong(lag(vix,1)),"market",-1)
add("VIX - realized 21d (VRP)",ong(lag(vix-rv.reindex(vix.index),1)),"market",1)
add("VIX z vs 252d",ong(lag(zs(vix,252),1)),"market",-1)
vxv=F("VXVCLS")
if vxv is not None: add("VIX/VIX3M [existing raw]",ong(lag(vix/vxv.reindex(vix.index),1)),"market",-1)
vxo=F("VXOCLS")
if vxo is not None: add("VXO level (1986+)",ong(lag(vxo,1)),"market",-1)
v9=Y("VIX9D")
if v9 is not None and len(v9)>100: add("VIX9D/VIX",ong(lag(v9/vix.reindex(v9.index),1)),"market",-1)
sk=Y("SKEW")
if sk is not None and len(sk)>100: add("SKEW 21d avg",ong(lag(sk.rolling(21).mean(),1)),"market",-1)
mv=Y("MOVE")
if mv is not None and len(mv)>100: add("MOVE index",ong(lag(mv,1)),"plumb",-1)
for a,b,lab,sg in [("XLY","XLP","XLY/XLP 63d rel",1),("RSP","SPY","RSP/SPY 63d rel (breadth)",1),("IWM","SPY","IWM/SPY 63d rel",1),("SMH","SPY","SMH/SPY 63d rel",1),("XLU","SPY","XLU/SPY 63d rel (defensive)",-1)]:
    A_=Y(a); B_=Y(b)
    if A_ is not None and B_ is not None: add(lab,ong(lag(rel63(A_,B_),1)),"market",sg)
nd=F("NASDAQCOM")
if nd is not None: add("Nasdaq/SPX 63d rel",ong(lag(rel63(nd,spx),1)),"market",1)
rut=Y("RUT")
if rut is not None: add("Russell2000/SPX 63d rel",ong(lag(rel63(rut,spx),1)),"market",1)
# --- commodities / fx ---
hg=Y("HG"); gc=Y("GOLD")
if hg is not None and gc is not None: add("Copper/Gold 63d chg",ong(lag(rel63(hg,gc),1)),"regime",1)
if gc is not None: add("Gold 12m momentum %",ong(lag((gc/gc.shift(252)-1)*100,1)),"regime",-1)
oil=d["DCOILWTICO"].s; add("WTI 12m chg %",ong(lag(yoy(oil,252),1)),"regime",-1)
add("WTI 30d chg % [existing raw]",ong(lag(yoy(oil,21),1)),"regime",-1)
dx=d["DTWEXBGS"].s; add("DXY 60d chg % [existing raw]",ong(lag((dx/dx.shift(42)-1)*100,4)),"regime",-1)
jp=d["DEXJPUS"].s; add("USDJPY 30d chg [existing raw]",ong(lag(jp-jp.shift(21),1)),"regime",1)
# --- valuation / positioning (ext) ---
cape=ext("shiller_cape")
if cape is not None:
    add("Shiller CAPE",ong(lag(cape,45)),"valuation",-1)
    if g10 is not None:
        ecy=(1/cape*100)-g10.resample("MS").mean().reindex(cape.index,method="ffill"); add("Excess CAPE yield (1/CAPE - 10y)",ong(lag(ecy,45)),"valuation",1)
md=ext("finra_margin_debt")
if md is not None: add("Margin debt yoy %",ong(lag(yoy(md),25)),"market",-1)
ism=ext("ism_manufacturing_pmi")
if ism is not None:
    add("ISM mfg PMI level (2007+)",ong(lag(ism,3)),"macro",1); add("ISM mfg PMI 3m chg",ong(lag(chg(ism,3),3)),"macro",1)
ab=ext("aaii_bull"); ar=ext("aaii_bear")
if ab is not None and ar is not None: add("AAII bull-bear 4wk",ong(lag((ab-ar.reindex(ab.index)).rolling(4).mean(),1)),"market",-1)
# --- plumbing (existing raw) ---
w=F("WALCL"); tga=F("WTREGEN"); rrp=F("RRPONTSYD"); res=F("TOTRESNS")
if w is not None: add("Fed balance sheet 13w chg %",ong(lag((w/w.shift(13)-1)*100,2)),"plumb",1)
if w is not None and tga is not None and rrp is not None:
    tg=tga.where(tga<=2500,tga/1000.0); nl=(w/1000.0-tg.reindex(w.index,method="ffill")-rrp.reindex(w.index,method="ffill").fillna(0))
    add("Net liquidity 13w chg % [existing raw]",ong(lag((nl/nl.shift(13)-1)*100,2)),"plumb",1)
if tga is not None: add("TGA 4w chg [existing raw]",ong(lag(tga-tga.shift(4),2)),"plumb",-1)
if res is not None: add("Total reserves yoy %",ong(lag(yoy(res),20)),"plumb",1)
sofr=F("SOFR"); iorb=F("IORB")
if sofr is not None and iorb is not None: add("SOFR-IORB bp [existing raw]",ong(lag((sofr-iorb.reindex(sofr.index,method="ffill"))*100,1)),"plumb",-1)

def boot_ic(x,y,nb=500,bl=13,seed=0):
    m=pd.concat([x,y],axis=1).dropna()
    if len(m)<80: return np.nan,np.nan,np.nan,len(m)
    xv=m.iloc[:,0].values; yv=m.iloc[:,1].values; ic=stats.spearmanr(xv,yv).correlation
    rng=np.random.default_rng(seed); n=len(m); nblk=int(np.ceil(n/bl)); ics=[]
    for _ in range(nb):
        st=rng.integers(0,n-bl,nblk); idx=np.concatenate([np.arange(s,s+bl) for s in st])[:n]
        ics.append(stats.spearmanr(xv[idx],yv[idx]).correlation)
    lo,hi=np.percentile(ics,[2.5,97.5]); return ic,lo,hi,n
rows=[]
for name,(s,blk,sg) in C.items():
    rec={"cand":name,"block":blk,"first":str(s.dropna().index[0].date()) if s.notna().any() else None,"cover":round(s.notna().mean(),2)}
    for hk in ("1m","3m","12m"):
        ic,lo,hi,n=boot_ic((s*sg).reindex(wk),fwd[hk].reindex(wk)); rec[f"ic_{hk}"]=ic; rec[f"lo_{hk}"]=lo; rec[f"hi_{hk}"]=hi
    for tag,lo_,hi_ in [("H1",None,"2008-12-31"),("H2","2009-01-01",None)]:
        ic,lo,hi,n=boot_ic((s*sg).reindex(wk).loc[lo_:hi_],fwd["3m"].reindex(wk).loc[lo_:hi_],nb=100); rec[f"ic3m_{tag}"]=ic
    x=(s*sg).reindex(wk); y=fwd["3m"].reindex(wk); m=pd.concat([x,y],axis=1).dropna()
    if len(m)>100:
        q=pd.qcut(m.iloc[:,0].rank(method="first"),5,labels=False)
        rec["q5-q1_3m_ann"]=(m.iloc[:,1][q==4].mean()-m.iloc[:,1][q==0].mean())*4*100
        rec["q1_3m_ann"]=m.iloc[:,1][q==0].mean()*4*100
        rec["q5_3m_ann"]=m.iloc[:,1][q==4].mean()*4*100
    rows.append(rec)
R=pd.DataFrame(rows).set_index("cand")
pd.set_option("display.width",280); pd.set_option("display.max_columns",30); pd.set_option("display.max_rows",300)
R["sig3m"]=np.where((R["lo_3m"]>0)|(R["hi_3m"]<0),"*","")
R["sig12m"]=np.where((R["lo_12m"]>0)|(R["hi_12m"]<0),"*","")
print(f"=== A4 candidate screen, window {grid[0].date()}..{grid[-1].date()} (IC signed so + = expected direction; * = 95% CI excludes 0) ===")
print(R[["block","first","cover","ic_1m","ic_3m","sig3m","ic_12m","sig12m","ic3m_H1","ic3m_H2","q1_3m_ann","q5_3m_ann","q5-q1_3m_ann"]].sort_values("ic_3m",ascending=False).round(3).to_string())
os.makedirs("out",exist_ok=True)
R.to_csv(f"out/a4_candidates_{START[:4]}.csv")
