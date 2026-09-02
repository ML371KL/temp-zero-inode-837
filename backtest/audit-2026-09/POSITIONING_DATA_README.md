# Positioning, capital-flow and rates datasets (free sources)

Collected 2026-09-02 into `razlom-audit/extdata/positioning/`. All files are tidy CSV, ascending, ISO dates. Raw downloads (zips, xls, json, html probes) are in `raw/`; `raw/make_readme.py` regenerates this file. Nothing here is fabricated: every number comes from the source files in `raw/`.

## Failures / gaps (read first)

- **CBOE put/call ratios** (`cdn.cboe.com/data/us/options/market_statistics/daily/{equity,index,total}_pc_ratio_history.csv`): HTTP 403 (AccessDenied) - skipped. Implied-correlation, SKEW and VVIX index histories from `cdn.cboe.com/api/global/us_indices/daily_prices/` worked.
- **FRED VXTLTCLS**: does not exist on FRED (HTML page returned) - skipped.
- **FRED BAMLHE00EHYIOAS** (euro HY OAS): only 2023-09-04 onward is served; history before that is gone from FRED.
- **CFTC `fut_fin_txt_2006_2016.zip`**: not on cftc.gov (404 HTML). TFF therefore starts 2010-07-20.
- **NAAIM**: the official page only embeds the last ~130 weeks; the full-history workbook is not linked from the page any more but is still hosted at `naaim.org/wp-content/uploads/.../USE_Data-since-Inception_<date>.xlsx` (found via the Wayback CDX index). Newest workbook found: 2026-07-29.
- **Treasury TIC raw mirror** (`ticdata.treasury.gov/Publish/mfh.txt`, `s1_globl.txt`): downloads succeeded but the mirror is stale (mfh.txt ends Jan-2023) - FRED's TIC series (current to Jun-2026) are used instead; raw files kept for reference.
- **TreasuryDirect `/securities/auctioned`**: silently caps at 250 rows (pagesize ignored) - full history pulled from `/securities/search` instead.
- **Fed custody** pre-2007 comes from a discontinued series with a ~2.7% level break (see file notes).

## Publication-lag summary (for aligning signals in a backtest)

| Dataset | Reference date | Available | Lag |
|---|---|---|---|
| CFTC COT (legacy, TFF) | Tuesday close | Friday 15:30 ET | 3 days (pre-2000 up to ~2 weeks) |
| NAAIM | Wednesday | Thursday ~noon ET | 1 day |
| ACM / Kim-Wright term premium | daily | weekly-ish, whole history re-estimated | not point-in-time |
| TIC flows and holdings | month | ~15th-18th of month+2 | ~45-48 days, revised |
| Fed custody (H.4.1) | Wednesday | Thursday 16:30 ET | 1 day |
| Treasury auctions | auction day | 11:32 / 13:02 ET same day | 0 |
| Cboe COR1M/COR3M/SKEW/VVIX | daily close | same day | 0 (pre-launch history back-filled) |
| FRED H.10 dollar indices, DEXUSEU | daily | following Monday | up to 7 days |
| T10Y2Y | daily | next business day | 1 day |
| RECPROUSM156N | month | month+2..3, re-smoothed | not point-in-time |

## Files

### `BAMLHE00EHYIOAS.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLHE00EHYIOAS
- **Definition:** ICE BofA Euro High Yield Index option-adjusted spread, % pts.
- **Frequency:** Daily.
- **Publication lag:** Next day.
- **Range:** 2023-09-04 .. 2026-08-31; **rows:** 793; **columns:** date, BAMLHE00EHYIOAS
- **Caveats:** FRED NOW ONLY SERVES DATA FROM 2023-09-04 (793 rows); the pre-2023 history has been removed from FRED (ICE licensing change) - cosd=1997 request returned the same truncated range. Use BAMLH0A0HYM2 (US HY) for a long history or source euro HY elsewhere.

First 3 rows:
```
      date  BAMLHE00EHYIOAS
2023-09-04             4.41
2023-09-05             4.39
2023-09-06             4.35
```
Last 3 rows:
```
      date  BAMLHE00EHYIOAS
2026-08-27             2.56
2026-08-28             2.55
2026-08-31             2.59
```

### `DEXUSEU.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXUSEU
- **Definition:** USD per EUR, noon buying rate NY (H.10).
- **Frequency:** Daily.
- **Publication lag:** H.10 weekly, up to 7 days.
- **Range:** 1999-01-04 .. 2026-08-28; **rows:** 7215; **columns:** date, DEXUSEU
- **Caveats:** Blank rows on holidays are dropped by pandas as NaN (kept as NaN).

First 3 rows:
```
      date  DEXUSEU
1999-01-04   1.1812
1999-01-05   1.1760
1999-01-06   1.1636
```
Last 3 rows:
```
      date  DEXUSEU
2026-08-26   1.1651
2026-08-27   1.1654
2026-08-28   1.1598
```

### `DTWEXAFEGS.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXAFEGS
- **Definition:** Nominal Advanced Foreign Economies U.S. Dollar Index (goods and services weights), Jan-2006=100.
- **Frequency:** Daily.
- **Publication lag:** Published by the Fed H.10 weekly (Monday) for the prior week -> up to 7 days; daily values thereafter.
- **Range:** 2006-01-02 .. 2026-08-28; **rows:** 5390; **columns:** date, DTWEXAFEGS
- **Caveats:** Series begins 2006; the older DTWEXM (major currencies) covers 1973-2019 if a longer history is needed.

First 3 rows:
```
      date  DTWEXAFEGS
2006-01-02    101.7857
2006-01-03    100.6967
2006-01-04    100.0512
```
Last 3 rows:
```
      date  DTWEXAFEGS
2026-08-26    111.8521
2026-08-27    111.7503
2026-08-28    112.2259
```

### `DTWEXEMEGS.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXEMEGS
- **Definition:** Nominal Emerging Market Economies U.S. Dollar Index (goods and services), Jan-2006=100.
- **Frequency:** Daily.
- **Publication lag:** H.10 weekly, up to 7 days.
- **Range:** 2006-01-02 .. 2026-08-28; **rows:** 5390; **columns:** date, DTWEXEMEGS
- **Caveats:** Begins 2006.

First 3 rows:
```
      date  DTWEXEMEGS
2006-01-02    100.9386
2006-01-03    100.8318
2006-01-04    100.4582
```
Last 3 rows:
```
      date  DTWEXEMEGS
2026-08-26    126.8392
2026-08-27    126.7660
2026-08-28    127.0648
```

### `GVZCLS.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=GVZCLS
- **Definition:** Cboe Gold ETF Volatility Index (GVZ), close.
- **Frequency:** Daily.
- **Publication lag:** Same/next day.
- **Range:** 2008-06-03 .. 2026-08-31; **rows:** 4760; **columns:** date, GVZCLS
- **Caveats:** From 2008-06.

First 3 rows:
```
      date  GVZCLS
2008-06-03   22.89
2008-06-04   22.69
2008-06-05   22.78
```
Last 3 rows:
```
      date  GVZCLS
2026-08-27   26.80
2026-08-28   25.17
2026-08-31   24.40
```

### `IRLTLT01JPM156N.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=IRLTLT01JPM156N
- **Definition:** Japan long-term (10-year) government bond yield, %, monthly average (OECD MEI).
- **Frequency:** Monthly.
- **Publication lag:** OECD MEI, ~1-2 months after month end.
- **Range:** 1989-01-01 .. 2026-06-01; **rows:** 450; **columns:** date, IRLTLT01JPM156N
- **Caveats:** Monthly average, not month-end.

First 3 rows:
```
      date  IRLTLT01JPM156N
1989-01-01            4.800
1989-02-01            4.894
1989-03-01            5.147
```
Last 3 rows:
```
      date  IRLTLT01JPM156N
2026-04-01            2.515
2026-05-01            2.650
2026-06-01            2.670
```

### `OVXCLS.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=OVXCLS
- **Definition:** Cboe Crude Oil ETF Volatility Index (OVX), close.
- **Frequency:** Daily.
- **Publication lag:** Same/next day.
- **Range:** 2007-05-10 .. 2026-08-31; **rows:** 5038; **columns:** date, OVXCLS
- **Caveats:** From 2007-05.

First 3 rows:
```
      date  OVXCLS
2007-05-10   27.09
2007-05-11   26.41
2007-05-14   27.23
```
Last 3 rows:
```
      date  OVXCLS
2026-08-27   46.22
2026-08-28   43.49
2026-08-31   44.91
```

### `RECPROUSM156N.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=RECPROUSM156N
- **Definition:** Smoothed U.S. recession probabilities (Chauvet-Piger dynamic-factor Markov-switching model), %.
- **Frequency:** Monthly.
- **Publication lag:** Published ~2-3 months after the reference month (needs 3 months of data); also re-smoothed -> NOT point-in-time.
- **Range:** 1967-06-01 .. 2026-07-01; **rows:** 710; **columns:** date, RECPROUSM156N
- **Caveats:** Use with a 3-month lag at minimum and treat as descriptive.

First 3 rows:
```
      date  RECPROUSM156N
1967-06-01           1.10
1967-07-01           0.54
1967-08-01           0.12
```
Last 3 rows:
```
      date  RECPROUSM156N
2026-05-01           0.54
2026-06-01           0.56
2026-07-01           0.76
```

### `T10Y2Y.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10Y2Y
- **Definition:** 10-Year minus 2-Year Treasury constant maturity spread, % pts.
- **Frequency:** Daily.
- **Publication lag:** Next business day (H.15).
- **Range:** 1976-06-01 .. 2026-09-01; **rows:** 13111; **columns:** date, T10Y2Y
- **Caveats:** Constant-maturity par yields.

First 3 rows:
```
      date  T10Y2Y
1976-06-01    0.68
1976-06-02    0.71
1976-06-03    0.70
```
Last 3 rows:
```
      date  T10Y2Y
2026-08-28    0.39
2026-08-31    0.41
2026-09-01    0.40
```

### `THREEFYTP10.csv`

- **Source:** https://fred.stlouisfed.org/graph/fredgraph.csv?id=THREEFYTP10
- **Definition:** Kim-Wright three-factor model 10-year term premium, % pts (Fed Board).
- **Frequency:** Daily.
- **Publication lag:** Updated by the Board weekly with ~1 week delay; full history re-estimated -> not point-in-time.
- **Range:** 1990-01-02 .. 2026-08-28; **rows:** 9564; **columns:** date, THREEFYTP10
- **Caveats:** Model-based; compare with acm_tp10.csv.

First 3 rows:
```
      date  THREEFYTP10
1990-01-02       1.8064
1990-01-03       1.8279
1990-01-04       1.8294
```
Last 3 rows:
```
      date  THREEFYTP10
2026-08-26       0.8394
2026-08-27       0.8465
2026-08-28       0.8751
```

### `acm_tp10.csv`

- **Source:** https://www.newyorkfed.org/medialibrary/media/research/data_indicators/ACMTermPremium.xls (sheet "ACM Daily")
- **Definition:** Adrian-Crump-Moench (2013) 10-year term premium (acm_tp10, % pts), ACM model-fitted 10y zero-coupon yield (acm_fitted_y10) and risk-neutral 10y yield (acm_risk_neutral_y10); tp = fitted - risk-neutral.
- **Frequency:** Daily (business days). acm_tp10_monthly.csv = sheet "ACM Monthly" (month-end).
- **Publication lag:** Model estimates, updated by the NY Fed roughly weekly/monthly with a few days delay; the whole history is re-estimated when the model is re-run -> NOT point-in-time. Early observations are subject to look-ahead from the full-sample estimation.
- **Range:** 1961-06-14 .. 2026-08-28; **rows:** 16267; **columns:** date, acm_tp10, acm_fitted_y10, acm_risk_neutral_y10
- **Caveats:** Not real-time; use for regime description, not as a strictly point-in-time signal. THREEFYTP10 (Kim-Wright) is a second model for cross-checking.

First 3 rows:
```
      date  acm_tp10  acm_fitted_y10  acm_risk_neutral_y10
1961-06-14  0.089406        3.812229              3.722823
1961-06-15  0.134230        3.868756              3.734526
1961-06-16  0.137715        3.872988              3.735273
```
Last 3 rows:
```
      date  acm_tp10  acm_fitted_y10  acm_risk_neutral_y10
2026-08-26  0.749916        4.723531              3.973616
2026-08-27  0.757819        4.737743              3.979924
2026-08-28  0.728036        4.794445              4.066410
```

### `acm_tp10_monthly.csv`

- **Source:** same as acm_tp10.csv, sheet "ACM Monthly"
- **Definition:** Month-end values of the same three ACM series.
- **Frequency:** Monthly (month-end).
- **Publication lag:** same as acm_tp10.csv
- **Range:** 1961-06-30 .. 2026-07-31; **rows:** 782; **columns:** date, acm_tp10, acm_fitted_y10, acm_risk_neutral_y10
- **Caveats:** same as acm_tp10.csv

First 3 rows:
```
      date  acm_tp10  acm_fitted_y10  acm_risk_neutral_y10
1961-06-30  0.165350        3.867357              3.702008
1961-07-31  0.411070        4.024976              3.613906
1961-08-31  0.300715        4.057584              3.756869
```
Last 3 rows:
```
      date  acm_tp10  acm_fitted_y10  acm_risk_neutral_y10
2026-05-29  0.666217        4.512749              3.846532
2026-06-30  0.512276        4.477133              3.964858
2026-07-31  0.837552        4.822998              3.985446
```

### `auctions_bills.csv`

- **Source:** same endpoint with type=Bill
- **Definition:** Every Treasury bill auction (4/6/8/13/17/26/52-week and cash-management bills); high_discount_rate and high_investment_rate instead of coupon yield (high_yield is NaN for bills); same bidder columns.
- **Frequency:** Event-based (several per week).
- **Publication lag:** Same-day (~11:32 ET).
- **Range:** 1979-12-28 .. 2026-09-03; **rows:** 8321; **columns:** auction_date, issue_date, maturity_date, security_term, security_type, cusip, reopening, tips, bid_to_cover, high_yield, high_discount_rate, high_investment_rate, median_yield, coupon, offering_amount, total_tendered, total_accepted, competitive_accepted, noncompetitive_accepted, indirect_accepted, direct_accepted, primary_dealer_accepted, soma_accepted, allocation_pct, indirect_pct, direct_pct, primary_dealer_pct, high_minus_median_bp
- **Caveats:** bid_to_cover from 1999-10; bidder classes from 2008-04; CMBs mixed in (security_term like "42-Day").

First 3 rows:
```
auction_date issue_date maturity_date security_term security_type     cusip reopening tips
  1979-12-28 1980-01-03    1980-04-03       13-Week          Bill 9127933Y0       Yes   No
  1979-12-28 1980-01-03    1980-07-03       26-Week          Bill 9127934U7        No   No
  1980-01-02 1980-01-08    1981-01-02       52-Week          Bill 9127935W2        No   No
```
Last 3 rows:
```
auction_date issue_date maturity_date security_term security_type     cusip reopening tips
  2026-09-02 2026-09-08    2027-01-05       17-Week          Bill 912797WN3        No   No
  2026-09-03 2026-09-08    2026-10-06        4-Week          Bill 912797VK0       Yes   No
  2026-09-03 2026-09-08    2026-11-03        8-Week          Bill 912797VP9       Yes   No
```

### `auctions_bonds.csv`

- **Source:** same endpoint with type=Bond
- **Definition:** Every Treasury bond auction (20-, 30-year incl. reopenings and TIPS bonds); same columns as auctions_notes.csv.
- **Frequency:** Event-based.
- **Publication lag:** Same-day (~13:02 ET).
- **Range:** 1979-11-01 .. 2026-08-19; **rows:** 392; **columns:** auction_date, issue_date, maturity_date, security_term, security_type, cusip, reopening, tips, bid_to_cover, high_yield, high_discount_rate, high_investment_rate, median_yield, coupon, offering_amount, total_tendered, total_accepted, competitive_accepted, noncompetitive_accepted, indirect_accepted, direct_accepted, primary_dealer_accepted, soma_accepted, allocation_pct, indirect_pct, direct_pct, primary_dealer_pct, high_minus_median_bp
- **Caveats:** bid_to_cover from 2000-02; bidder classes from 2008-05. No bond auctions Nov-2001..Feb-2006 (30y suspended).

First 3 rows:
```
auction_date issue_date maturity_date   security_term security_type     cusip reopening tips
  1979-11-01 1979-11-15    2009-11-15         30-Year          Bond 912810CK2        No   No
  1980-01-03 1980-01-10    1995-02-15 15-Year 1-Month          Bond 912810CL0        No   No
  1980-02-07 1980-02-15    2010-02-15         30-Year          Bond 912810CM8        No   No
```
Last 3 rows:
```
auction_date issue_date maturity_date    security_term security_type     cusip reopening tips
  2026-07-22 2026-07-24    2046-05-15 19-Year 10-Month          Bond 912810UV8       Yes   No
  2026-08-13 2026-08-17    2056-08-15          30-Year          Bond 912810UW6        No   No
  2026-08-19 2026-08-31    2046-08-15          20-Year          Bond 912810UX4        No   No
```

### `auctions_notes.csv`

- **Source:** https://www.treasurydirect.gov/TA_WS/securities/search?format=json&type=Note&dateFieldName=auctionDate&startDate=01/01/1979&endDate=12/31/2026 (the /auctioned endpoint caps at 250 rows regardless of pagesize - do not use it for history)
- **Definition:** Every Treasury note auction. bid_to_cover = tendered/accepted; high_yield (%); median_yield; indirect/direct/primary_dealer_accepted (USD) and *_pct = share of COMPETITIVE accepted (market convention); high_minus_median_bp = (high - median yield) x 100 (a proxy for the "tail"; the true tail vs when-issued yield is not in this feed); total_accepted, offering_amount in USD; reopening/tips/frn flags.
- **Frequency:** Event-based (per auction; 2-, 3-, 5-, 7-, 10-year incl. reopenings and TIPS/FRN notes).
- **Publication lag:** Results are published ~13:02 ET on auction day -> lag 0 days (same-day after 13:00 ET).
- **Range:** 1979-10-31 .. 2026-08-27; **rows:** 1965; **columns:** auction_date, issue_date, maturity_date, security_term, security_type, cusip, reopening, tips, bid_to_cover, high_yield, high_discount_rate, high_investment_rate, median_yield, coupon, offering_amount, total_tendered, total_accepted, competitive_accepted, noncompetitive_accepted, indirect_accepted, direct_accepted, primary_dealer_accepted, soma_accepted, allocation_pct, indirect_pct, direct_pct, primary_dealer_pct, high_minus_median_bp
- **Caveats:** bid_to_cover available from 1994-09; bidder-class breakdown (indirect/direct/dealer) only from 2008-04; median_yield from the start. TIPS notes have high_yield = real yield; FRNs have discount margins instead (high_yield NaN). Filter by security_term and tips/frn flags before use.

First 3 rows:
```
auction_date issue_date maturity_date  security_term security_type     cusip reopening tips
  1979-10-31 1979-11-15    1989-11-15        10-Year          Note 912827KC5        No   No
  1980-01-23 1980-01-31    1982-01-31         2-Year          Note 912827KH4        No   No
  1980-02-05 1980-02-15    1983-08-15 3-Year 6-Month          Note 912827KJ0        No   No
```
Last 3 rows:
```
auction_date issue_date maturity_date security_term security_type     cusip reopening tips
  2026-08-25 2026-08-31    2028-08-31        2-Year          Note 91282CRH6        No   No
  2026-08-26 2026-08-31    2031-08-31        5-Year          Note 91282CRK9        No   No
  2026-08-27 2026-08-31    2033-08-31        7-Year          Note 91282CRJ2        No   No
```

### `cboe_cor1m.csv`

- **Source:** https://cdn.cboe.com/api/global/us_indices/daily_prices/COR1M_History.csv
- **Definition:** Cboe 1-Month Implied Correlation Index (close). Measures the market-implied average correlation of the top-50 SPX constituents from 1-month options.
- **Frequency:** Daily.
- **Publication lag:** Same day after close (index published intraday).
- **Range:** 2006-01-03 .. 2026-09-01; **rows:** 5198; **columns:** date, cor1m
- **Caveats:** History back to 2006 is back-calculated by Cboe (index launched 2022); not point-in-time before launch. Only the close is kept (raw OHLC in raw/).

First 3 rows:
```
      date  cor1m
2006-01-03  23.50
2006-01-04  24.33
2006-01-05  23.55
```
Last 3 rows:
```
      date  cor1m
2026-08-28   8.87
2026-08-31  10.06
2026-09-01  12.64
```

### `cboe_cor3m.csv`

- **Source:** https://cdn.cboe.com/api/global/us_indices/daily_prices/COR3M_History.csv
- **Definition:** Cboe 3-Month Implied Correlation Index (close).
- **Frequency:** Daily.
- **Publication lag:** Same day.
- **Range:** 2006-01-03 .. 2026-09-01; **rows:** 5183; **columns:** date, cor3m
- **Caveats:** Same as COR1M.

First 3 rows:
```
      date  cor3m
2006-01-03  31.34
2006-01-04  31.12
2006-01-05  30.92
```
Last 3 rows:
```
      date  cor3m
2026-08-28  10.17
2026-08-31  10.13
2026-09-01  11.15
```

### `cboe_skew.csv`

- **Source:** https://cdn.cboe.com/api/global/us_indices/daily_prices/SKEW_History.csv
- **Definition:** Cboe SKEW Index (close): 100 + 10 x (implied skewness of 30-day SPX log-returns); 100 = lognormal, higher = fatter left tail priced.
- **Frequency:** Daily.
- **Publication lag:** Same day.
- **Range:** 1990-01-02 .. 2026-09-01; **rows:** 9218; **columns:** date, skew
- **Caveats:** Launched 2011; pre-2011 back-calculated.

First 3 rows:
```
      date   skew
1990-01-02 126.09
1990-01-03 123.34
1990-01-04 122.62
```
Last 3 rows:
```
      date   skew
2026-08-28 149.77
2026-08-31 148.53
2026-09-01 149.23
```

### `cboe_vvix.csv`

- **Source:** https://cdn.cboe.com/api/global/us_indices/daily_prices/VVIX_History.csv
- **Definition:** Cboe VVIX (close): 30-day implied volatility of VIX options.
- **Frequency:** Daily.
- **Publication lag:** Same day.
- **Range:** 2006-03-06 .. 2026-09-01; **rows:** 5095; **columns:** date, vvix
- **Caveats:** Launched 2012; pre-2012 back-calculated.

First 3 rows:
```
      date  vvix
2006-03-06 71.73
2006-03-15 15.71
2006-03-16 27.94
```
Last 3 rows:
```
      date  vvix
2026-08-28 86.63
2026-08-31 86.29
2026-09-01 91.25
```

### `cot_legacy_crude_wti.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip
- **Definition:** CFTC Legacy COT, futures only, NYMEX Light Sweet Crude (WTI), code 067651 (renamed "WTI-PHYSICAL" 2022-02-08).
- **Frequency:** Weekly since 1993; twice-monthly 1986-1992.
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 1986-01-15 .. 2026-08-25; **rows:** 1930; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** Futures-only; the large swap/financial WTI contracts (06765A etc.) are excluded. Consider the "futures and options combined" report for a fuller picture.

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
1986-01-15          74334          2560          11594            5317      53426       42097         13031
1986-01-31          66522          3405           8095            3289      46248       38391         13580
1986-02-14          66316          5325           6896            3166      44962       43196         12863
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2026-08-11        1892429        314846         215650          604890     897344     1026981         75349
2026-08-18        1888960        320159         198069          598872     894821     1047908         75108
2026-08-25        1906740        323243         199794          616707     892144     1048390         74646
```

### `cot_legacy_gold.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip
- **Definition:** CFTC Legacy COT, futures only, COMEX Gold 100 oz, code 088691.
- **Frequency:** Weekly since 1993; twice-monthly 1986-1992.
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 1986-01-15 .. 2026-08-25; **rows:** 1931; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** None found (no gaps > 3 weeks).

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
1986-01-15         148186         18589           7706           12038      80962       89990         36597
1986-01-31         144149         15364           9303           10088      82262       85250         36435
1986-02-14         139995          5457          12229           10330      94830       76735         29378
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2026-08-11         400309        250936          32996           28937      69385      322025         51051
2026-08-18         406260        256902          34713           28961      69050      327468         51347
2026-08-25         427957        277159          33825           33620      62453      342038         54725
```

### `cot_legacy_jpy.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip
- **Definition:** CFTC Legacy COT, futures only, CME/IMM Japanese Yen (12.5m JPY), code 097741. Positive net = long yen vs USD.
- **Frequency:** Weekly since 1993; twice-monthly 1986-1992.
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 1986-01-15 .. 2026-08-25; **rows:** 1932; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** None found.

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
1986-01-15          23231          7668            715              90       5234       18333         10239
1986-01-31          31732         14509           1331             395       2761       25823         14067
1986-02-14          34452         12512           2195            2761       7023       22202         12156
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2026-08-11         391874        134188         176273           15361     208293      159524         34032
2026-08-18         380811        128932         181825           18465     200835      139761         32579
2026-08-25         384216        128340         191638           24270     197062      129225         34544
```

### `cot_legacy_sp500_consolidated.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip
- **Definition:** CFTC Legacy COT, futures only, "S&P 500 Consolidated" (full-size + e-mini (+ micro) expressed in full-size-contract equivalents), code 13874+.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 2010-06-15 .. 2026-08-25; **rows:** 846; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** Only from 2010-06-15. This is the series most analysts quote as "S&P 500 futures positioning".

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2010-06-15        1132309         67613          83149           45466     819504      825894        199725
2010-06-22         822092         67766          72899           11381     594634      615490        148310
2010-06-29         850401         69820          70834           18957     613773      639288        147851
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2026-08-11        2146778        282930         275497           68549    1514567     1648263        280732
2026-08-18        2099170        270678         286414           57332    1494128     1597499        277032
2026-08-25        2074931        229741         307916           56975    1508843     1557869        279372
```

### `cot_legacy_sp500_emini.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip
- **Definition:** CFTC Legacy COT, futures only, CME E-mini S&P 500 ($50 x index), code 13874A. Same columns as above.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 1997-09-16 .. 2026-08-25; **rows:** 1506; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** Name changed 2022-02-08 ("E-MINI S&P 500 STOCK INDEX" -> "E-MINI S&P 500"); joined on CFTC code. Contract is 1/5 of the full-size; do not mix contract counts with the large contract without scaling.

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
1997-09-16           7578          1363            522              30       2051        1953          4134
1997-09-23           5684          1413            343              30        954        2017          3287
1997-09-30           5874          1413           1297              30       1220         319          3211
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2026-08-11        2119506        291707         280427           50255    1504981     1647421        272563
2026-08-18        2072358        275315         285875           45644    1482869     1596422        268530
2026-08-25        2045669        241495         309489           40332    1493154     1557219        270688
```

### `cot_legacy_sp500_large.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip (Legacy, futures-only, annual.txt)
- **Definition:** CFTC Legacy COT, futures only, CME S&P 500 full-size ($250 x index) contract, CFTC code 138741. Positions in contracts. net_noncomm = noncomm_long - noncomm_short; net_*_pct_oi = net / open_interest * 100.
- **Frequency:** Weekly (Tuesday) since 1993; twice-monthly (mid-month/month-end) 1986-1992.
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 1986-01-15 .. 2021-09-14; **rows:** 1632; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** Contract delisted in Sept 2021 (last row 2021-09-14); OI shrinks after 2015 and weeks are missing in 2020-21. For a continuous S&P series use cot_legacy_sp500_consolidated.csv (from 2010) or e-mini. Contract renamed over time (IMM -> CME) - joined on CFTC code.

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
1986-01-15          61706          9386           6323             982      29116       29119         22222
1986-01-31          63660          3405           6424             649      31665       27329         27941
1986-02-14          70245          5779           5986               0      37974       32357         26492
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2021-08-31          46078         24746          12996             300      18835        7469          2197
2021-09-07          45641         23946          15458             200      18625        8092          2870
2021-09-14          45572         24526           9692             300      17595        9665          3151
```

### `cot_legacy_usd_index.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip
- **Definition:** CFTC Legacy COT, futures only, U.S. Dollar Index (NYCE -> NYBOT -> ICE Futures U.S.), codes 098661 (to 1992-05-15) + 098662.
- **Frequency:** Weekly since 1993; twice-monthly 1986-1992.
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 1986-01-15 .. 2026-08-25; **rows:** 1866; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** Weeks missing in 2000-2002 (gaps of 4-22 weeks, e.g. after 2002-01-29: 154 days) - contract fell below CFTC reporting thresholds. Small OI (tens of thousands) -> noisy % of OI.

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
1986-01-15           2522           477             20            1584          0         299           461
1986-01-31           2288           124            193            1231        303         100           630
1986-02-14           3299           118            586            1571        804           0           806
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2026-08-11          49541         32651          11242            1571      11516       34944          3803
2026-08-18          47928         29582          10503            1667      12803       33479          3876
2026-08-25          47953         29042          10360            1609      13957       33795          3345
```

### `cot_legacy_ust_10y.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip
- **Definition:** CFTC Legacy COT, futures only, CBOT 10-Year T-Note, code 043602 (1986-88 name "6.5-10 YEAR U.S. TREASURY NOTE").
- **Frequency:** Weekly since 1993; twice-monthly 1986-1992.
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 1986-01-15 .. 2026-08-25; **rows:** 1932; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** Renamed "UST 10Y NOTE" on 2022-02-08. Ultra 10Y (043607) is separate and not included; since 2016 a meaningful share of 10y exposure sits in Ultra 10Y.

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
1986-01-15          75839           852           7184            1556      68690       59505          4741
1986-01-31          79073          1152           8272             995      71977       61950          4949
1986-02-14          78110          3025           8868            1269      66911       59437          6905
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2026-08-11        5458890        499227        1414280          169840    4392463     3478452        397360
2026-08-18        5596739        536297        1483258          197096    4414142     3499757        449204
2026-08-25        6208739        514737        1353712          634320    4522410     3747385        537272
```

### `cot_legacy_ust_bonds.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip
- **Definition:** CFTC Legacy COT, futures only, CBOT U.S. Treasury Bond (classic 15-25y basket), code 020601.
- **Frequency:** Weekly since 1993; twice-monthly 1986-1992.
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 1986-01-15 .. 2026-08-25; **rows:** 1932; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** Renamed "UST BOND" on 2022-02-08; joined on code. Ultra T-Bond (020604) is a separate contract, not included.

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
1986-01-15         322195         18627          31805           12957     202310      181722         88301
1986-01-31         321761         20190          34948           16136     206990      181693         78445
1986-02-14         316881         28698          25424           10880     195154      195307         82149
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2026-08-11        1862944        205313         384920           28905    1395599     1288492        233127
2026-08-18        1894436        176229         395241           34525    1447191     1282527        236491
2026-08-25        2096351        170997         358240           95488    1522880     1430137        306986
```

### `cot_legacy_vix.csv`

- **Source:** https://www.cftc.gov/files/dea/history/deacot{YYYY}.zip
- **Definition:** CFTC Legacy COT, futures only, CBOE VIX futures, code 1170E1.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 2004-07-27 .. 2026-08-25; **rows:** 1110; **columns:** date, open_interest, noncomm_long, noncomm_short, noncomm_spread, comm_long, comm_short, nonrept_long, nonrept_short, net_noncomm, net_comm, net_noncomm_pct_oi, net_comm_pct_oi, market_name, cftc_code
- **Caveats:** Starts 2004-07-27; gaps in 2006 (98 days) and 2009 (168 days after 2009-06-02) when the contract was below reporting thresholds. Liquid/continuous only from late 2009.

First 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2004-07-27           6450          2547            255             283       1673        4366          1947
2004-08-03           6850          2476            685             493       1786        4550          2095
2004-08-10           7479          2173            529             384       3151        5502          1771
```
Last 3 rows:
```
      date  open_interest  noncomm_long  noncomm_short  noncomm_spread  comm_long  comm_short  nonrept_long
2026-08-11         382010         81749         156683           83514     193170      115873         23577
2026-08-18         417768         87155         176601           81276     226170      136848         23167
2026-08-25         378681         80331         158495           75064     198460      119880         24826
```

### `cot_tff_jpy.csv`

- **Source:** https://www.cftc.gov/files/dea/history/fut_fin_txt_{YYYY}.zip (Traders in Financial Futures, futures-only, FinFutYY.txt)
- **Definition:** CFTC TFF report, futures only, CME Japanese Yen, code 097741. Categories: Dealer/Intermediary, Asset Manager/Institutional, Leveraged Funds, Other Reportables, Non-reportable. net_X = X_long - X_short; net_X_pct_oi = net_X / open_interest * 100. Spread positions are reported separately and not in the nets.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 2010-07-20 .. 2026-08-25; **rows:** 841; **columns:** date, open_interest, dealer_long, dealer_short, dealer_spread, asset_mgr_long, asset_mgr_short, asset_mgr_spread, lev_money_long, lev_money_short, lev_money_spread, other_rept_long, other_rept_short, other_rept_spread, nonrept_long, nonrept_short, net_dealer, net_dealer_pct_oi, net_asset_mgr, net_asset_mgr_pct_oi, net_lev_money, net_lev_money_pct_oi, net_other_rept, net_other_rept_pct_oi, net_nonrept, net_nonrept_pct_oi, market_name, cftc_code
- **Caveats:** CFTC publishes TFF only from mid-2010 (first row 2010-07-20 in the annual files); the combined 2006-2016 archive (fut_fin_txt_2006_2016.zip) does NOT exist on cftc.gov (returned an HTML 404 page). Category classification is self-reported by traders and can shift (e.g. a fund reclassified from Other to Leveraged Funds).

First 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2010-07-20         127658         6433         83629           1695           36284             9359              1362
2010-07-27         124595         7079         71422           2845           35593             8845              1304
2010-08-03         133870         7078         85108           1858           34323             8869              1314
```
Last 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2026-08-11         391874       102902         79645          16744           72247            98498             20504
2026-08-18         380811       102005         58035          16951           71829            97572             23933
2026-08-25         384216        99992         57054          16572           71421            91537             25216
```

### `cot_tff_sp500_consolidated.csv`

- **Source:** https://www.cftc.gov/files/dea/history/fut_fin_txt_{YYYY}.zip (Traders in Financial Futures, futures-only, FinFutYY.txt)
- **Definition:** CFTC TFF report, futures only, S&P 500 Consolidated (full-size equivalents), code 13874+. Categories: Dealer/Intermediary, Asset Manager/Institutional, Leveraged Funds, Other Reportables, Non-reportable. net_X = X_long - X_short; net_X_pct_oi = net_X / open_interest * 100. Spread positions are reported separately and not in the nets.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 2010-07-20 .. 2026-08-25; **rows:** 841; **columns:** date, open_interest, dealer_long, dealer_short, dealer_spread, asset_mgr_long, asset_mgr_short, asset_mgr_spread, lev_money_long, lev_money_short, lev_money_spread, other_rept_long, other_rept_short, other_rept_spread, nonrept_long, nonrept_short, net_dealer, net_dealer_pct_oi, net_asset_mgr, net_asset_mgr_pct_oi, net_lev_money, net_lev_money_pct_oi, net_other_rept, net_other_rept_pct_oi, net_nonrept, net_nonrept_pct_oi, market_name, cftc_code
- **Caveats:** CFTC publishes TFF only from mid-2010 (first row 2010-07-20 in the annual files); the combined 2006-2016 archive (fut_fin_txt_2006_2016.zip) does NOT exist on cftc.gov (returned an HTML 404 page). Category classification is self-reported by traders and can shift (e.g. a fund reclassified from Other to Leveraged Funds).

First 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2010-07-20         870890        69325        213533          38686          439798           163886             55169
2010-07-27         868087        64249        221794          46345          436528           160962             55894
2010-08-03         865807        62864        229690          54246          426131           154923             58146
```
Last 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2026-08-11        2146778       216544        987006          70384         1156714           206446             95406
2026-08-18        2099170       220311        993943          67785         1167721           205018             83306
2026-08-25        2074931       207772        952263          77352         1168355           213379             86000
```

### `cot_tff_sp500_emini.csv`

- **Source:** https://www.cftc.gov/files/dea/history/fut_fin_txt_{YYYY}.zip (Traders in Financial Futures, futures-only, FinFutYY.txt)
- **Definition:** CFTC TFF report, futures only, CME E-mini S&P 500, code 13874A. Categories: Dealer/Intermediary, Asset Manager/Institutional, Leveraged Funds, Other Reportables, Non-reportable. net_X = X_long - X_short; net_X_pct_oi = net_X / open_interest * 100. Spread positions are reported separately and not in the nets.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 2010-07-20 .. 2026-08-25; **rows:** 841; **columns:** date, open_interest, dealer_long, dealer_short, dealer_spread, asset_mgr_long, asset_mgr_short, asset_mgr_spread, lev_money_long, lev_money_short, lev_money_spread, other_rept_long, other_rept_short, other_rept_spread, nonrept_long, nonrept_short, net_dealer, net_dealer_pct_oi, net_asset_mgr, net_asset_mgr_pct_oi, net_lev_money, net_lev_money_pct_oi, net_other_rept, net_other_rept_pct_oi, net_nonrept, net_nonrept_pct_oi, market_name, cftc_code
- **Caveats:** CFTC publishes TFF only from mid-2010 (first row 2010-07-20 in the annual files); the combined 2006-2016 archive (fut_fin_txt_2006_2016.zip) does NOT exist on cftc.gov (returned an HTML 404 page). Category classification is self-reported by traders and can shift (e.g. a fund reclassified from Other to Leveraged Funds).

First 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2010-07-20        2814633       207952        543947         152096         1405126           619132            227012
2010-07-27        2780454       225442        569071         146606         1385586           605119            231428
2010-08-03        2745286       226979        587288         154956         1353761           583107            229988
```
Last 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2026-08-11        2119506       216163        995795          61405         1154700           206219             95003
2026-08-18        2072358       219986       1004401          57027         1165359           204793             83194
2026-08-25        2045669       207277        968313          61299         1166084           212856             85838
```

### `cot_tff_usd_index.csv`

- **Source:** https://www.cftc.gov/files/dea/history/fut_fin_txt_{YYYY}.zip (Traders in Financial Futures, futures-only, FinFutYY.txt)
- **Definition:** CFTC TFF report, futures only, ICE U.S. Dollar Index, code 098662. Categories: Dealer/Intermediary, Asset Manager/Institutional, Leveraged Funds, Other Reportables, Non-reportable. net_X = X_long - X_short; net_X_pct_oi = net_X / open_interest * 100. Spread positions are reported separately and not in the nets.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 2010-07-20 .. 2026-08-25; **rows:** 841; **columns:** date, open_interest, dealer_long, dealer_short, dealer_spread, asset_mgr_long, asset_mgr_short, asset_mgr_spread, lev_money_long, lev_money_short, lev_money_spread, other_rept_long, other_rept_short, other_rept_spread, nonrept_long, nonrept_short, net_dealer, net_dealer_pct_oi, net_asset_mgr, net_asset_mgr_pct_oi, net_lev_money, net_lev_money_pct_oi, net_other_rept, net_other_rept_pct_oi, net_nonrept, net_nonrept_pct_oi, market_name, cftc_code
- **Caveats:** CFTC publishes TFF only from mid-2010 (first row 2010-07-20 in the annual files); the combined 2006-2016 archive (fut_fin_txt_2006_2016.zip) does NOT exist on cftc.gov (returned an HTML 404 page). Category classification is self-reported by traders and can shift (e.g. a fund reclassified from Other to Leveraged Funds).

First 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2010-07-20          24176        10227         15430              0             263               50               845
2010-07-27          22557        10123         15301              0              90               50               828
2010-08-03          22911         9632         15185              0              84              135               839
```
Last 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2026-08-11          49541         5724         33016              0           18450             1923              1207
2026-08-18          47928         5893         33150              0           16792             1794              1313
2026-08-25          47953         6047         33200              0           15863             1845              1482
```

### `cot_tff_ust_10y.csv`

- **Source:** https://www.cftc.gov/files/dea/history/fut_fin_txt_{YYYY}.zip (Traders in Financial Futures, futures-only, FinFutYY.txt)
- **Definition:** CFTC TFF report, futures only, CBOT 10-Year T-Note, code 043602. Categories: Dealer/Intermediary, Asset Manager/Institutional, Leveraged Funds, Other Reportables, Non-reportable. net_X = X_long - X_short; net_X_pct_oi = net_X / open_interest * 100. Spread positions are reported separately and not in the nets.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 2010-07-20 .. 2026-08-25; **rows:** 841; **columns:** date, open_interest, dealer_long, dealer_short, dealer_spread, asset_mgr_long, asset_mgr_short, asset_mgr_spread, lev_money_long, lev_money_short, lev_money_spread, other_rept_long, other_rept_short, other_rept_spread, nonrept_long, nonrept_short, net_dealer, net_dealer_pct_oi, net_asset_mgr, net_asset_mgr_pct_oi, net_lev_money, net_lev_money_pct_oi, net_other_rept, net_other_rept_pct_oi, net_nonrept, net_nonrept_pct_oi, market_name, cftc_code
- **Caveats:** CFTC publishes TFF only from mid-2010 (first row 2010-07-20 in the annual files); the combined 2006-2016 archive (fut_fin_txt_2006_2016.zip) does NOT exist on cftc.gov (returned an HTML 404 page). Category classification is self-reported by traders and can shift (e.g. a fund reclassified from Other to Leveraged Funds).

First 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2010-07-20        1843850       117591        317047          35099          964931           412708            187364
2010-07-27        1831973        80085        306255          39805          962674           435274            195294
2010-08-03        1807891        66194        327358          45376         1004773           393980            182612
```
Last 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2026-08-11        5458890       162930        637196          66281         3290600           736189            665819
2026-08-18        5596739       190379        679773          75762         3353552           768057            648936
2026-08-25        6208739       163799        744106         198300         3282567           690495            829594
```

### `cot_tff_ust_bonds.csv`

- **Source:** https://www.cftc.gov/files/dea/history/fut_fin_txt_{YYYY}.zip (Traders in Financial Futures, futures-only, FinFutYY.txt)
- **Definition:** CFTC TFF report, futures only, CBOT U.S. Treasury Bond, code 020601. Categories: Dealer/Intermediary, Asset Manager/Institutional, Leveraged Funds, Other Reportables, Non-reportable. net_X = X_long - X_short; net_X_pct_oi = net_X / open_interest * 100. Spread positions are reported separately and not in the nets.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 2010-07-20 .. 2026-08-25; **rows:** 841; **columns:** date, open_interest, dealer_long, dealer_short, dealer_spread, asset_mgr_long, asset_mgr_short, asset_mgr_spread, lev_money_long, lev_money_short, lev_money_spread, other_rept_long, other_rept_short, other_rept_spread, nonrept_long, nonrept_short, net_dealer, net_dealer_pct_oi, net_asset_mgr, net_asset_mgr_pct_oi, net_lev_money, net_lev_money_pct_oi, net_other_rept, net_other_rept_pct_oi, net_nonrept, net_nonrept_pct_oi, market_name, cftc_code
- **Caveats:** CFTC publishes TFF only from mid-2010 (first row 2010-07-20 in the annual files); the combined 2006-2016 archive (fut_fin_txt_2006_2016.zip) does NOT exist on cftc.gov (returned an HTML 404 page). Category classification is self-reported by traders and can shift (e.g. a fund reclassified from Other to Leveraged Funds).

First 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2010-07-20         682517        23450        158925           4038          365308           145858             54151
2010-07-27         691590        23611        151869           3179          367419           153836             53118
2010-08-03         692587        19166        165586           3394          359695           143536             64245
```
Last 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2026-08-11        1862944        23520        266816           8677         1061726           512076            260156
2026-08-18        1894436        21756        308058          10608         1083456           485989            260226
2026-08-25        2096351        31274        297481         103727         1071112           549364            291361
```

### `cot_tff_vix.csv`

- **Source:** https://www.cftc.gov/files/dea/history/fut_fin_txt_{YYYY}.zip (Traders in Financial Futures, futures-only, FinFutYY.txt)
- **Definition:** CFTC TFF report, futures only, CBOE VIX futures, code 1170E1. Categories: Dealer/Intermediary, Asset Manager/Institutional, Leveraged Funds, Other Reportables, Non-reportable. net_X = X_long - X_short; net_X_pct_oi = net_X / open_interest * 100. Spread positions are reported separately and not in the nets.
- **Frequency:** Weekly (Tuesday).
- **Publication lag:** Released Friday 15:30 ET for positions as of Tuesday close -> publication lag 3 days (longer around US holidays). For a backtest, use the data no earlier than Friday close of the same week; before 2000 reports were published every two weeks, so the effective real-time lag for pre-2000 rows may be up to ~2 weeks.
- **Range:** 2010-07-20 .. 2026-08-25; **rows:** 841; **columns:** date, open_interest, dealer_long, dealer_short, dealer_spread, asset_mgr_long, asset_mgr_short, asset_mgr_spread, lev_money_long, lev_money_short, lev_money_spread, other_rept_long, other_rept_short, other_rept_spread, nonrept_long, nonrept_short, net_dealer, net_dealer_pct_oi, net_asset_mgr, net_asset_mgr_pct_oi, net_lev_money, net_lev_money_pct_oi, net_other_rept, net_other_rept_pct_oi, net_nonrept, net_nonrept_pct_oi, market_name, cftc_code
- **Caveats:** CFTC publishes TFF only from mid-2010 (first row 2010-07-20 in the annual files); the combined 2006-2016 archive (fut_fin_txt_2006_2016.zip) does NOT exist on cftc.gov (returned an HTML 404 page). Category classification is self-reported by traders and can shift (e.g. a fund reclassified from Other to Leveraged Funds).

First 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2010-07-20          96183        65457         29620          11658             200             1993               100
2010-07-27          84826        56893         28337          11559             200                0                 0
2010-08-03          93493        63018         31238          12368             916                0                 0
```
Last 3 rows:
```
      date  open_interest  dealer_long  dealer_short  dealer_spread  asset_mgr_long  asset_mgr_short  asset_mgr_spread
2026-08-11         382010        79670         39502          28486           49073            76177             51591
2026-08-18         417768        87632         42954          33137           53725            80887             61265
2026-08-25         378681        84654         32864          23506           49710            72598             54289
```

### `fed_custody_foreign.csv`

- **Source:** FRED H.4.1 memorandum items: WMTSECL1 (Marketable U.S. Treasury securities held in custody for foreign official and international accounts, Wednesday level) spliced with discontinued WMTSECL before 2007-07-04; custody_total_musd = WSEFINT1 (total securities in custody, week average) spliced with WSEFINTL before 2007-07-04.
- **Definition:** Weekly Fed custody holdings for foreign official and international accounts, millions USD. Column source_treas says which FRED series the Treasury value came from.
- **Frequency:** Weekly (Wednesday).
- **Publication lag:** H.4.1 is released Thursday ~16:30 ET for the Wednesday -> lag 1 day.
- **Range:** 2002-12-18 .. 2026-08-26; **rows:** 1237; **columns:** date, custody_treasuries_musd, custody_total_musd, source_treas
- **Caveats:** SPLICE BREAK: on the 2007-2012 overlap the discontinued WMTSECL is systematically ~2.7% higher than WMTSECL1 (ratio median 0.973, range 0.958-0.977) - different valuation/definition. Treat 2002-2007 rows as a separate regime or use only changes within each segment. FRED WMTSECL1 reports 0 (not NaN) before 2007-07-04, replaced here with WMTSECL. Custody holdings cover only securities held at the FRBNY, not total foreign official reserves.

First 3 rows:
```
      date  custody_treasuries_musd  custody_total_musd source_treas
2002-12-18                 685673.0            847705.0      WMTSECL
2002-12-25                 685042.0            848468.0      WMTSECL
2003-01-01                 690003.0            855053.0      WMTSECL
```
Last 3 rows:
```
      date  custody_treasuries_musd  custody_total_musd source_treas
2026-08-12                2596842.0           2887695.0     WMTSECL1
2026-08-19                2586171.0           2870870.0     WMTSECL1
2026-08-26                2615246.0           2878051.0     WMTSECL1
```

### `naaim.csv`

- **Source:** https://naaim.org/wp-content/uploads/2026/07/USE_Data-since-Inception_2026-07-29.xlsx (NAAIM "USE Data since Inception" workbook; link discovered via Wayback CDX index of naaim.org uploads; page https://www.naaim.org/programs/naaim-exposure-index/ embeds only the last ~130 weeks via index.naaim.org iframes)
- **Definition:** NAAIM Exposure Index: average equity exposure (% of portfolio, -200..+200) reported by NAAIM member active managers in a weekly survey. Columns: mean (the headline index), most bearish/bullish response, quartiles, std dev, NAAIM Number (= mean), S&P 500 level on the survey date.
- **Frequency:** Weekly, survey dated Wednesday.
- **Publication lag:** Responses collected Mon-Wed, published Thursday (around 12:00 ET) -> lag ~1 day after the Wednesday date. Values are recorded as published (no revisions).
- **Range:** 2006-07-05 .. 2026-07-29; **rows:** 1047; **columns:** date, naaim_exposure_mean, most_bearish, q1, median_q2, q3, most_bullish, std_dev, naaim_number, sp500
- **Caveats:** Workbook runs to 2026-07-29 (newest file found); later weeks (Aug 2026) were not yet posted as a workbook when fetched. Survey of ~30-40 self-selected managers, very noisy; the -200/+200 extremes are single respondents. Early 2006-2007 rows have the mean recorded with full precision (e.g. 19.444444).

First 3 rows:
```
      date  naaim_exposure_mean  most_bearish  q1  median_q2   q3  most_bullish   std_dev
2006-07-05            19.444444        -100.0 0.0       20.0 50.0         100.0 55.550000
2006-07-12            31.200000         -50.0 0.0       25.0 50.0         150.0 47.838896
2006-07-19            18.760000        -100.0 0.0       25.0 50.0         100.0 38.170439
```
Last 3 rows:
```
      date  naaim_exposure_mean  most_bearish   q1  median_q2    q3  most_bullish  std_dev
2026-07-15                95.64         -25.0 90.0      100.0 100.0         200.0    47.97
2026-07-22                84.02         -25.0 85.0       95.5 100.0         200.0    43.61
2026-07-29                79.70           0.0 60.0       90.0 100.0         200.0    48.99
```

### `tic_foreign_holdings_total.csv`

- **Source:** FRED mirrors of Treasury TIC: FORTREASPOS99996, FORLTTREASPOS99996, FORTREASPOS99990, FORTREASPOS99991, FORTREASPOS42609 (Japan), FORTREASPOS41408 (China), FORLTTOTALPOS99996.
- **Definition:** Foreign portfolio holdings of U.S. Treasury securities, millions USD, month-end: total (LT + ST), long-term only, foreign official, foreign non-official, Japan, China (mainland), and all US long-term securities.
- **Frequency:** Monthly (month-end levels; date = first day of the month per FRED convention).
- **Publication lag:** ~45-48 days (same TIC release as the transactions). Cross-checked vs Treasury mfh.txt: Japan Jan-2023 FRED 1,102,923 vs mfh 1,104.4 bn (revision), China 859,342 vs 859.4 bn (exact).
- **Range:** 1984-12-01 .. 2026-06-01; **rows:** 499; **columns:** date, foreign_holdings_treasuries_total_musd, foreign_holdings_lt_treasuries_musd, foreign_official_holdings_treasuries_musd, foreign_nonofficial_holdings_treasuries_musd, japan_holdings_treasuries_musd, china_holdings_treasuries_musd, foreign_holdings_all_us_lt_securities_musd
- **Caveats:** Holdings are benchmark-survey based estimates carried forward with transactions between surveys; large revisions at each June benchmark. Country attribution is by custodian location.

First 3 rows:
```
      date  foreign_holdings_treasuries_total_musd  foreign_holdings_lt_treasuries_musd  foreign_official_holdings_treasuries_musd  foreign_nonofficial_holdings_treasuries_musd  japan_holdings_treasuries_musd  china_holdings_treasuries_musd  foreign_holdings_all_us_lt_securities_musd
1984-12-01                                  194490                               118122                                     144081                                         50409                             NaN                             NaN                                      268080
1985-01-01                                  196137                               122110                                     144077                                         52060                             NaN                             NaN                                      282881
1985-02-01                                  191043                               121443                                     138756                                         52287                             NaN                             NaN                                      286223
```
Last 3 rows:
```
      date  foreign_holdings_treasuries_total_musd  foreign_holdings_lt_treasuries_musd  foreign_official_holdings_treasuries_musd  foreign_nonofficial_holdings_treasuries_musd  japan_holdings_treasuries_musd  china_holdings_treasuries_musd  foreign_holdings_all_us_lt_securities_musd
2026-04-01                                 9352646                              7854033                                    3906503                                       5446143                       1209889.0                        651072.0                                    37756765
2026-05-01                                 9371073                              7915937                                    3847999                                       5523074                       1143139.0                        659282.0                                    39176817
2026-06-01                                 9298959                              7872852                                    3778118                                       5520841                       1116683.0                        633381.0                                    39189956
```

### `tic_net_lt_purchases.csv`

- **Source:** FRED mirrors of Treasury TIC (release "Treasury International Capital: Continuous Securities Long Term"): FORLTTOTALNET99996, FORLTTREASNET99996, FORLTTREASNET99990, FORLTEQTYNET99996, FORLTCORPNET99996, FORLTAGCYNET99996, USLTTOTALNET99996 via https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>. Treasury raw (ticdata.treasury.gov/Publish/s1_globl.txt, slt1d_globl.csv) was also downloaded to raw/ but its mirror is stale (mfh.txt stops at Jan-2023), so FRED is the primary.
- **Definition:** Monthly net foreign purchases of U.S. long-term securities, millions USD (positive = foreigners net buyers). Columns: all US LT securities (grand total), LT Treasuries (all foreigners; and foreign official), US equities, corporate bonds, agency bonds; plus net US purchases of foreign LT securities (positive = US residents net buyers abroad).
- **Frequency:** Monthly (date = first day of the reference month).
- **Publication lag:** TIC monthly data are released around the 15th-18th of the second month after the reference month -> lag ~45-48 days. Subject to revision (annual benchmark surveys revise holdings; transactions are revised for a few months).
- **Range:** 1985-01-01 .. 2026-06-01; **rows:** 498; **columns:** date, net_foreign_purchases_all_us_lt_musd, net_foreign_purchases_us_lt_treasuries_musd, net_foreign_official_purchases_us_lt_treasuries_musd, net_foreign_purchases_us_equities_musd, net_foreign_purchases_us_corp_bonds_musd, net_foreign_purchases_us_agency_bonds_musd, net_us_purchases_foreign_lt_musd
- **Caveats:** Transactions data (TIC S) exclude valuation changes and are known to misattribute custodial-centre flows (UK, Belgium, Caymans, Luxembourg). Grand Total (99996) vs All Countries (69995) differ in whether international orgs are included.

First 3 rows:
```
      date  net_foreign_purchases_all_us_lt_musd  net_foreign_purchases_us_lt_treasuries_musd  net_foreign_official_purchases_us_lt_treasuries_musd  net_foreign_purchases_us_equities_musd  net_foreign_purchases_us_corp_bonds_musd  net_foreign_purchases_us_agency_bonds_musd  net_us_purchases_foreign_lt_musd
1985-01-01                                  4749                                         2677                                                  2376                                    -743                                      2943                                        -128                               NaN
1985-02-01                                  7130                                         2586                                                  1205                                     -85                                      4247                                         382                               NaN
1985-03-01                                 -1675                                        -4129                                                 -5455                                    -452                                      2975                                         -68                               NaN
```
Last 3 rows:
```
      date  net_foreign_purchases_all_us_lt_musd  net_foreign_purchases_us_lt_treasuries_musd  net_foreign_official_purchases_us_lt_treasuries_musd  net_foreign_purchases_us_equities_musd  net_foreign_purchases_us_corp_bonds_musd  net_foreign_purchases_us_agency_bonds_musd  net_us_purchases_foreign_lt_musd
2026-04-01                                207362                                        50515                                                 16123                                  109576                                     20704                                       26567                          102093.0
2026-05-01                                262845                                        56581                                                  3029                                  134620                                     52524                                       19120                           31646.0
2026-06-01                                207076                                         6778                                                 -9822                                  181426                                     35633                                      -16761                           34350.0
```
