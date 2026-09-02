# extdata — free historical datasets for the US macro-regime backtest

All files: `date,value`, ISO dates, ascending, one observation per row, no missing rows within each series' own cadence.
Fetched 2026-09-02 with curl on Windows. Raw source files are kept in `raw/` for reproducibility.
Nothing was fabricated; where a source failed it is stated below.

| # | Dataset | File(s) | Status | Range |
|---|---------|---------|--------|-------|
| 1 | Shiller monthly stock data | `shiller_*.csv` (9 files) | OK | 1871-01 .. 2026-08 (CAPE from 1881-01) |
| 2 | OECD CLI, USA, amplitude adjusted | `oecd_cli_usa.csv` | OK (via OECD SDMX API; DBnomics MEI_CLI stale) | 1955-01 .. 2026-06 |
| 3 | FINRA margin debt | `finra_margin_debt.csv` | OK (FINRA era only, no 1959–1996 NYSE data) | 1997-01 .. 2026-07 |
| 4 | AAII sentiment (weekly) | `aaii_bull.csv`, `aaii_bear.csv`, `aaii_neutral.csv` | OK | 1987-07-24 .. 2026-08-27 |
| 5 | CBOE equity put/call ratio | — | FAILED (CDN 403; only per-day HTML pages) | — |
| 6 | ISM Manufacturing PMI | `ism_manufacturing_pmi.csv` (+ `_with_release_dates.csv`) | OK (mql5 calendar export, as-first-published) | 2007-02 .. 2026-07 |

---

## 1. Shiller monthly stock data (Robert Shiller, Yale)

- **Source:** `https://shillerdata.com/` → `ie_data.xls` (the wsimg.com download link on that page; file "Last Saved By: Laurence Black", data through Aug 2026). The Yale URL `http://www.econ.yale.edu/~shiller/data/ie_data.xls` still works (HTTP 200) but serves a file last saved **2023-09-17** (data through Sep 2023) — kept as `raw/ie_data_yale_2023-09.xls` for reference; all CSVs come from the shillerdata.com file `raw/ie_data_shillerdata_2026.xls`.
- **Sheet:** `Data`, header rows 1–8, data from row 9. Column `Date` like `2020.01` = Jan 2020 → `2020-01-01` (parsed as round((x−int(x))·100), so `2020.1` = October is handled correctly).
- **Frequency:** monthly.
- **Files and what the value is:**
  - `shiller_price.csv` — S&P Composite price (col P). **Monthly average of daily closes, not month-end** (Shiller's convention). Exception per the file's footnote: the last month (Aug 2026) is the **Aug 1 close**, not an average.
  - `shiller_dividend.csv` — nominal 12-month trailing dividends per share (col D), interpolated monthly from quarterly S&P data. Ends 2026-06.
  - `shiller_earnings.csv` — **nominal** 12-month trailing earnings per share (col E, S&P reported/GAAP earnings), interpolated monthly from quarterly data. Ends 2026-03 (last quarter with final reported earnings).
  - `shiller_earnings_real.csv` — same, CPI-deflated to the latest CPI (col "Real Earnings"). Ends 2026-03.
  - `shiller_cpi.csv` — CPI-U, not seasonally adjusted (col CPI). File footnote: **"Oct '25/July/Aug CPI estimated"** — Oct 2025 (BLS gap) and Jul–Aug 2026 are Shiller's estimates, not BLS prints.
  - `shiller_gs10.csv` — 10-year Treasury yield, percent (col "Long Interest Rate GS10"), monthly; Aug 2026 = Jul 31 value per footnote.
  - `shiller_cape.csv` — CAPE / P/E10 (col "Cyclically Adjusted Price Earnings Ratio"): real price ÷ 10-year average real earnings. From 1881-01.
  - `shiller_tr_cape.csv` — Total-Return CAPE (col "TR CAPE", dividends-reinvested variant). From 1881-01.
  - `shiller_excess_cape_yield.csv` — Excess CAPE Yield = 1/CAPE − real 10-year yield, **as a decimal** (0.0097 = 0.97 %). From 1881-01.
- **Publication lag (realistic):** the workbook is refreshed by Shiller's team irregularly, roughly monthly with 1–6 weeks delay. Components: price — 0 days after month end (average of known closes); CPI — BLS release ~10–15 days after month end (Shiller fills the newest months with estimates); earnings — S&P reported EPS become final ~2–3 months after quarter end, Shiller interpolates and back-fills. So the **last ~3–6 months of CAPE are provisional** (estimated CPI, interpolated E). Because CAPE's denominator is a 10-year average, a 1–3 month earnings lag moves CAPE by well under 1 %; for the backtest, treat CAPE for month M as available at the end of month M (price component exact, small look-ahead in E/CPI), or lag by one month to be conservative.
- **Caveats:** monthly-average price ≠ month-end price (do not mix with month-end returns without care); pre-1926 data are Cowles Commission reconstructions; Shiller's E is GAAP "reported" earnings, not operating earnings.

### Verification

`shiller_price.csv`
```
rows=1868  range=1871-01-01..2026-08-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1871-01-01,4.44
  1871-02-01,4.5
  1871-03-01,4.61
last 3:
  2026-06-01,7450.032857142856
  2026-07-01,7481.33909090909
  2026-08-01,7600.5
```

`shiller_dividend.csv`
```
rows=1866  range=1871-01-01..2026-06-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1871-01-01,0.26
  1871-02-01,0.26
  1871-03-01,0.26
last 3:
  2026-04-01,80.58670000000001
  2026-05-01,80.8081
  2026-06-01,81.0295
```

`shiller_earnings.csv`
```
rows=1863  range=1871-01-01..2026-03-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1871-01-01,0.4
  1871-02-01,0.4
  1871-03-01,0.4
last 3:
  2026-01-01,247.66366666666664
  2026-02-01,254.69333333333333
  2026-03-01,261.723
```

`shiller_earnings_real.csv`
```
rows=1863  range=1871-01-01..2026-03-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1871-01-01,10.6890922861935
  1871-02-01,10.372379942797812
  1871-03-01,10.220927288688667
last 3:
  2026-01-01,253.61955098021423
  2026-02-01,259.5947293582426
  2026-03-01,263.99039732309143
```

`shiller_cpi.csv`
```
rows=1868  range=1871-01-01..2026-08-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1871-01-01,12.46406116
  1871-02-01,12.84464132
  1871-03-01,13.0349719
last 3:
  2026-06-01,333.952
  2026-07-01,333.3665
  2026-08-01,333.07375
```

`shiller_gs10.csv`
```
rows=1868  range=1871-01-01..2026-08-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1871-01-01,5.32
  1871-02-01,5.323333333333333
  1871-03-01,5.326666666666667
last 3:
  2026-06-01,4.47
  2026-07-01,4.6
  2026-08-01,4.75
```

`shiller_cape.csv`
```
rows=1748  range=1881-01-01..2026-08-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1881-01-01,18.473952301404932
  1881-02-01,18.14725816499023
  1881-03-01,18.27011914020499
last 3:
  2026-06-01,40.49374282511722
  2026-07-01,40.61542498003572
  2026-08-01,41.17762140136851
```

`shiller_tr_cape.csv`
```
rows=1748  range=1881-01-01..2026-08-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1881-01-01,24.13505742196503
  1881-02-01,23.655503266150117
  1881-03-01,23.767712891469262
last 3:
  2026-06-01,43.2956550878852
  2026-07-01,43.40346393273702
  2026-08-01,43.98158358324
```

`shiller_excess_cape_yield.csv`
```
rows=1748  range=1881-01-01..2026-08-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1881-01-01,-0.010488744813437
  1881-02-01,-0.011392839551264
  1881-03-01,-0.0131231180772923
last 3:
  2026-06-01,0.0131453565918031
  2026-07-01,0.0117573885374301
  2026-08-01,0.0097356443052899
```

---

## 2. OECD Composite Leading Indicator — United States, amplitude adjusted

- **File:** `oecd_cli_usa.csv`. Value = CLI, amplitude adjusted, long-term average = 100 (OECD codes `LI / AA / H` = Composite leading indicator, Amplitude adjusted, OECD harmonised).
- **Source actually used:** OECD Data Explorer SDMX REST API (no key, browser UA):
  `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.1/USA.M.LI...AA...H?startPeriod=1950-01&format=csvfilewithlabels`
  (raw: `raw/oecd_sdmx_DF_CLI_USA.csv`, 858 rows, arrives unsorted — sorted here).
- **DBnomics:** `https://api.db.nomics.world/v22/series/OECD/MEI_CLI/LOLITOAA.USA.M` still exists but is **stale** (indexed 2024-01-13, ends 2023-12; kept as `raw/dbnomics_MEI_CLI_USA_stale.json`). `api.db.nomics.world` was unreachable over IPv6 from this machine and needed `curl -4`; even then `/v22/search` timed out (60 s), so the replacement dataset could not be located on DBnomics. On OECD's side the old MEI_CLI dataset was superseded by `DSD_STES@DF_CLI`.
- **Cross-check:** FRED `USALOLITOAASTSAM` (curl default UA) has identical coverage 1955-01..2026-06; max |diff| vs the OECD SDMX values = 5e-5 (same vintage). Kept as `raw/fred_USALOLITOAASTSAM.csv`.
- **Frequency:** monthly.
- **Publication lag:** OECD historically released the CLI in the 2nd week of month M+2 (~5–6 weeks after month end); in 2022–2024 the release moved to ~10 days after month end. Empirically on 2026-09-02 the latest observation is **June 2026** — the July value was not out ~2 months after July's end — so the current effective lag is ≥ 6 weeks. **Use ≥ 45 days** (conservatively 60) in the backtest.
- **Caveats (important):** the CLI is **heavily revised**; this is the latest vintage, not point-in-time. Against the Jan-2024 DBnomics vintage the same months differ by up to **0.68 index points** (828 overlapping months), larger than typical month-to-month moves. A backtest on this series overstates real-time signal quality; turning points in particular are sharpened ex post.

### Verification
`oecd_cli_usa.csv`
```
rows=858  range=1955-01-01..2026-06-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1955-01-01,101.4664
  1955-02-01,101.8208
  1955-03-01,102.1139
last 3:
  2026-04-01,100.7113
  2026-05-01,100.7588
  2026-06-01,100.8024
```

---

## 3. FINRA margin debt

- **File:** `finra_margin_debt.csv`. Value = **Debit balances in customers' securities margin accounts, USD millions** (column B of the FINRA workbook). The workbook also has free credit balances in cash accounts and in margin accounts (not exported; see `raw/finra_margin-statistics.xlsx`).
- **Source:** `https://www.finra.org/investors/learn-to-invest/advanced-investing/margin-statistics` → linked workbook `https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx` (browser UA; despite the `2021-03` path the file is current — last row 2026-07).
- **Frequency:** monthly (end-of-month balances).
- **Range:** 1997-01 .. 2026-07 (355 rows). **The 1959–1996 NYSE margin-debt history is NOT in this file** and FINRA does not host it; it would have to come from NYSE Facts & Figures archives (not attempted).
- **Publication lag:** FINRA posts month M in the second half of month M+1, typically ~3–4 weeks after month end (July 2026 was available on 2026-09-02). Use 25 days.
- **Caveats:** pre-2010 rows are NYSE-member data, FINRA collects since 2010 — series is spliced by FINRA itself, no visible break. Nominal dollars; normalise by market cap or GDP for regime use.

### Verification
`finra_margin_debt.csv`
```
rows=355  range=1997-01-01..2026-07-01  sorted=True  dup_dates=0  NaN=0
first 3:
  1997-01-01,103337
  1997-02-01,103886
  1997-03-01,104835
last 3:
  2026-05-01,1415557
  2026-06-01,1502072
  2026-07-01,1417225
```

---

## 4. AAII Investor Sentiment Survey (weekly)

- **Files:** `aaii_bull.csv`, `aaii_bear.csv`, `aaii_neutral.csv`. Value = share of respondents, **in percent** (the xls stores decimals; multiplied by 100, rounded to 2 dp).
- **Source:** `https://www.aaii.com/files/surveys/sentiment.xls` (linked from `https://www.aaii.com/sentimentsurvey/sent_results`). **No login required**, but the site sits behind Imperva/Incapsula: a bare `Mozilla/5.0 (Windows NT 10.0; Win64; x64)` UA got 403; a full Chrome UA string plus `Accept`/`Referer` headers got the file (1.3 MB). Raw: `raw/aaii_sentiment.xls`, sheet `SENTIMENT` (also has the 8-week MA, bull-bear spread, long-run averages, S&P weekly OHLC — not exported).
- **Frequency:** weekly. The date is AAII's "Reported Date" (Thursday); the survey window is the preceding Thursday–Wednesday.
- **Range:** 1987-07-24 .. 2026-08-27, 2038 weekly rows. The first two rows of the xls (1987-06-26, 1987-07-17) have no bull/bear values and are dropped. 9 places where consecutive dates are 9–21 days apart (1987-07, several 1989–1992 holiday weeks, 2000-07-06, 2021-01-21) — weeks the survey was not published, not missing rows.
- **Publication lag:** results are posted Thursday morning for the week ending Wednesday → 0–1 day. Use 1 day.
- **Caveats:** the xls contains a "Terms of Service" sheet (personal, non-commercial use). Early years (1987–early 1990s) had very small samples and were partly irregular. Response counts are not in the file.

### Verification
`aaii_bull.csv`
```
rows=2038  range=1987-07-24..2026-08-27  sorted=True  dup_dates=0  NaN=0
first 3:
  1987-07-24,36.0
  1987-07-31,26.0
  1987-08-07,56.0
last 3:
  2026-08-13,34.7
  2026-08-20,35.47
  2026-08-27,32.92
```

`aaii_bear.csv`
```
rows=2038  range=1987-07-24..2026-08-27  sorted=True  dup_dates=0  NaN=0
first 3:
  1987-07-24,14.0
  1987-07-31,26.0
  1987-08-07,29.0
last 3:
  2026-08-13,37.9
  2026-08-20,39.9
  2026-08-27,44.44
```

`aaii_neutral.csv`
```
rows=2038  range=1987-07-24..2026-08-27  sorted=True  dup_dates=0  NaN=0
first 3:
  1987-07-24,50.0
  1987-07-31,48.0
  1987-08-07,15.0
last 3:
  2026-08-13,27.4
  2026-08-20,24.63
  2026-08-27,22.63
```

---

## 5. CBOE equity put/call ratio — FAILED

- Tried (browser UA), all **HTTP 403 AccessDenied** from the cdn.cboe.com S3 bucket:
  `cdn.cboe.com/data/us/options/market_statistics/daily/equitypc.csv`, `.../historical/equitypc.csv`, `.../archive/equitypc.csv`, `cdn.cboe.com/resources/us/options/market_statistics/daily/equitypc.csv`, `.../archive/equitypc.csv`, `cdn.cboe.com/resources/options/equitypc.csv`, `cdn.cboe.com/api/global/us_options/market_statistics/daily/`, `.../daily_volume_put_call_ratios/equity_ratios.csv`. The legacy `www.cboe.com/publish/scheduledtask/mktdata/datahouse/equitypc.csv` now returns an HTML page.
- What **does** work: `https://www.cboe.com/us/options/market_statistics/daily/?dt=YYYY-MM-DD` returns 200 with the day's ratios embedded server-side in the Next.js payload (`"name":"EQUITY PUT/CALL RATIO","value":"0.62"` for 2026-08-28). Rebuilding history this way is one request per trading day (~5,000 requests for 2006–2026) — outside the 10-minute budget, so **skipped**. If needed later: loop over business days, regex `EQUITY PUT/CALL RATIO\",\"value\":\"([0-9.]+)`, ~1 s/request, and first check that old dates actually return data rather than the empty shell (the 2010-06-15 page had the same byte size as 2026-08-28, which suggests it may not).
- No other free mirror was found; Nasdaq Data Link is behind Incapsula/403 without a key.

---

## 6. ISM Manufacturing PMI

- **Files:** `ism_manufacturing_pmi.csv` (`date` = observation month, `value` = headline PMI); `ism_manufacturing_pmi_with_release_dates.csv` (`obs_month,release_date,value`) for point-in-time alignment.
- **Source actually used:** MQL5 economic-calendar export (free, no key, browser UA):
  `https://www.mql5.com/en/economic-calendar/united-states/ism-manufacturing-pmi/export` — TSV with `Date` (release date), `ActualValue`, `ForecastValue`, `PreviousValue`. Raw: `raw/mql5_ism_manufacturing_pmi_export.tsv`. Observation month = release month − 1 (ISM releases on the 1st business day of the following month; release days in the file are the 1st–5th).
- **Range:** 2007-02 .. 2026-07, 234 rows, no gaps.
- **Data-quality check:** for 213 of 233 rows `PreviousValue` equals the prior row's `ActualValue`; the 20 mismatches are almost all the **February releases** (January data) of 2008, 2010, 2012, 2013, 2018–2022, 2024, 2025 plus a run in 2012 — exactly when ISM re-benchmarks seasonal factors. So the values here are **as-first-published prints (point-in-time)**, not the revised history that ISM/FRED-style sources show. Good for a backtest; do not expect them to match a revised series to the decimal.
- **Publication lag:** 1–3 days after month end (10:00 ET on the first business day of M+1). Use the `release_date` column, or 3 days.
- **Failed alternatives:** FRED `NAPM` — 404 (removed 2016). DBnomics `ISM/pmi` — exists but is **broken**: only 68 obs from 2020-05 and the last four values are 11.1/10.0/10.0/10.3 (scraper picking up the wrong field); kept as `raw/dbnomics_ISM_pmi_broken.json`, not used. Nasdaq Data Link `ISM/MAN_PMI` — 403 (Incapsula, key required).
- **Caveats:** history before 2007 is not in this source (ISM PMI exists from 1948); for pre-2007 the Philadelphia/NY Fed surveys on FRED remain the fallback. The mql5 calendar is a third-party transcription — spot-check a few prints against ISM press releases before relying on it.

### Verification
`ism_manufacturing_pmi.csv`
```
rows=234  range=2007-02-01..2026-07-01  sorted=True  dup_dates=0  NaN=0
first 3:
  2007-02-01,52.3
  2007-03-01,50.9
  2007-04-01,54.7
last 3:
  2026-05-01,54.0
  2026-06-01,53.3
  2026-07-01,55.6
```

---

## Environment notes (for reproducing)
- FRED must be fetched with curl's **default** UA (a Mozilla UA gets blocked); AAII, FINRA, OECD, mql5, CBOE need a browser UA (AAII needs a full Chrome UA + Accept/Referer).
- `api.db.nomics.world`: force IPv4 (`curl -4`); responses take 25–35 s; `/v22/search` times out entirely.
- Python 3.11 with pandas 3.0.3, xlrd 2.0.2, openpyxl available.
