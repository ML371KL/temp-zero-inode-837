"""
INDEPENDENT backtest harness for the Razlom-26 dashboard.

- Reuses ONLY the dashboard's SIGNAL definition (engine.build_scores/composite),
  which is the object under test (faithful port of docs/index.html scoring).
- Everything else — the live hysteresis ladder machine, the portfolio simulator,
  the benchmarks, the statistics, the Monte-Carlo null — is written here from
  scratch and is deliberately skeptical.

The tradable object = equity exposure recommended by the "что делать сейчас"
action block: rungs {4:100%,3:85%,2:65%,1:35%,0:0%} of a 100% strategic-norm
equity sleeve, remainder in 3M T-bills, executed next session.
"""
import pandas as pd, numpy as np, sys, os, json, pickle
sys.path.insert(0, os.path.dirname(__file__))
import engine as E

CACHE = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE, exist_ok=True)

RUNG_PCT = {4:1.00, 3:0.85, 2:0.65, 1:0.35, 0:0.00}

# ----------------------------------------------------------------------------
# 1. SIGNAL: composite + lead + coverage + detectors + hardMarket + override
# ----------------------------------------------------------------------------
def build_signal(d, grid, era_fair=False, variants=frozenset(), tag="base"):
    key = os.path.join(CACHE, f"sig_{tag}_{era_fair}_{'_'.join(sorted(variants))}_{grid[0].date()}_{grid[-1].date()}.pkl")
    if os.path.exists(key):
        return pickle.load(open(key,"rb"))
    df, A = E.build_scores(d, grid, era_fair=era_fair, variants=variants)
    out = E.composite(df, A, variants=variants)
    # hardMarket components (all FRED-reproducible), per docs/index.html:2205
    hy   = A.get("hy",      pd.Series(np.nan, index=grid))
    hymom= A.get("hy_mom",  pd.Series(np.nan, index=grid))
    vix  = A.get("vix",     pd.Series(np.nan, index=grid))
    rvol = A.get("ratevol", pd.Series(0.0,   index=grid))
    jpyu = A.get("jpy_unwind", pd.Series(0.0, index=grid))
    hardMarket = ( ((hy>450)&(hymom>75)).astype(float).fillna(0)
                 + (jpyu>0.5).astype(float).fillna(0)
                 + (vix>35).astype(float).fillna(0)
                 + (rvol>10).astype(float).fillna(0) )
    fund = out["fund_fired"].astype(bool)
    # Reproducible kill-switch branch only: F.fund && hardMarket>=2.
    # (news branches capex/bdc are un-reproducible from public data -> omitted)
    override = fund & (hardMarket>=2)
    sig = out.copy()
    sig["hardMarket"] = hardMarket
    sig["override"] = override.astype(bool)
    sig["fund"] = fund
    sig["df_cols"] = None
    res = (sig, df, A)
    pickle.dump(res, open(key,"wb"))
    return res

# ----------------------------------------------------------------------------
# 2. LADDER MACHINE — faithful port of docs/index.html:2306-2361 (v4.13.x)
#    daily step; one rung/move; +/-3pt hysteresis (score & lead); next-day
#    confirmation; upgrade-freeze while a detector fired; kill-switch immediate.
# ----------------------------------------------------------------------------
def rung_from(c, l, thr=(30,10,-10,-30), gate=(10,-10)):
    buy, hp, hd, red = thr; gu, gd = gate
    if c >= buy:  return 4 if l >= gu else 3
    if c >= hp:   return 3
    if c > hd:    return 2
    if c >= red:  return 1
    return 1 if l > gd else 0

def ladder_machine(sig, use_hysteresis=True, use_confirm=True, use_freeze=True,
                   use_override=True, hyst=3, seed_rung=2, thr=(30,10,-10,-30), gate=(10,-10)):
    def rf(c, l): return rung_from(c, l, thr, gate)
    idx = sig.index
    score = sig["composite"].values
    lead  = sig["lead"].values
    cover = sig["cover"].values
    fired = sig["fund"].values           # detector that freezes upgrades (funding)
    ov    = sig["override"].values
    n = len(idx)
    cur = None; pend = None; pend_day = -1
    rung = np.empty(n)
    for t in range(n):
        c, l = score[t], lead[t]
        nodata = cover[t] < 0.6
        if use_override and ov[t]:
            if cur != 0: cur = 0
            pend = None; pend_day = -1
        elif nodata or np.isnan(c):
            if cur is None: cur = seed_rung
            # hold; keep pending as-is
        else:
            raw = rf(c, l)
            if cur is None:
                cur = raw
            elif raw != cur:
                tgt = cur + (1 if raw > cur else -1)
                if use_hysteresis:
                    if tgt > cur and rf(c-hyst, l-hyst) <= cur: tgt = cur
                    elif tgt < cur and rf(c+hyst, l+hyst) >= cur: tgt = cur
                if use_freeze and fired[t] and tgt > cur: tgt = cur
                if tgt != cur:
                    confirmed = (not use_confirm) or (pend == tgt and pend_day >= 0 and pend_day < t)
                    if confirmed:
                        cur = tgt
                        # cascade: arm next step immediately if warranted (one rung/day)
                        raw2 = rf(c, l)
                        up_ok = raw2 > cur and not (use_freeze and fired[t]) and (not use_hysteresis or rf(c-hyst,l-hyst) > cur)
                        dn_ok = raw2 < cur and (not use_hysteresis or rf(c+hyst,l+hyst) < cur)
                        if up_ok or dn_ok:
                            pend = cur + (1 if raw2 > cur else -1); pend_day = t
                        else:
                            pend = None; pend_day = -1
                    else:
                        # new candidate -> start its confirmation clock at t;
                        # same candidate as yesterday -> keep original clock so it confirms tomorrow
                        if pend != tgt:
                            pend = tgt; pend_day = t
                else:
                    pend = None; pend_day = -1
            else:
                pend = None; pend_day = -1
        rung[t] = cur if cur is not None else seed_rung
    expo = pd.Series([RUNG_PCT[int(r)] for r in rung], index=idx)
    return expo, pd.Series(rung, index=idx)

def verdict_expo(sig):
    """Naive verdict->exposure (their run.py style), no hysteresis machine."""
    v = np.array([rung_from(c,l) for c,l in zip(sig["composite"].values, sig["lead"].values)], float)
    v[sig["cover"].values < 0.6] = 2  # NA -> 65%
    return pd.Series([RUNG_PCT[int(r)] for r in v], index=sig.index)

# ----------------------------------------------------------------------------
# 3. PORTFOLIO SIMULATION
# ----------------------------------------------------------------------------
def simulate(expo, tr_ret, cash_ret, cost_bps=10.0, exec_lag=1):
    e = expo.shift(exec_lag).reindex(tr_ret.index).ffill().fillna(RUNG_PCT[2])
    turn = e.diff().abs().fillna(0.0)
    r = e*tr_ret + (1-e)*cash_ret - turn*(cost_bps/1e4)
    return r, e

def metrics(r, cash_ret, freq=252):
    eq = (1+r).cumprod()
    yrs = len(r)/freq
    cagr = eq.iloc[-1]**(1/yrs) - 1
    vol = r.std()*np.sqrt(freq)
    exc = r - cash_ret.reindex(r.index).fillna(0)
    sharpe = exc.mean()*freq/ (r.std()*np.sqrt(freq)) if r.std()>0 else 0
    downside = np.sqrt((np.minimum(r-0.0,0.0)**2).mean())*np.sqrt(freq)  # RMS below target=0 (textbook)
    sortino = exc.mean()*freq/downside if downside>0 else 0
    dd = (eq/eq.cummax()-1)
    maxdd = dd.min()
    calmar = cagr/abs(maxdd) if maxdd<0 else np.nan
    # worst rolling 1y
    roll1y = eq.pct_change(freq).min()
    return dict(cagr=cagr, vol=vol, sharpe=sharpe, sortino=sortino, maxdd=maxdd,
                calmar=calmar, worst1y=roll1y, final=eq.iloc[-1])

def capture(r_strat, r_bh):
    up = r_bh>0; dn = r_bh<0
    uc = r_strat[up].mean()/r_bh[up].mean() if r_bh[up].mean()!=0 else np.nan
    dc = r_strat[dn].mean()/r_bh[dn].mean() if r_bh[dn].mean()!=0 else np.nan
    return uc, dc

if __name__ == "__main__":
    print("harness module OK")
