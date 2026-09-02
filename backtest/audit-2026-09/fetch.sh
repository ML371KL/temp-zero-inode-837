#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
mkdir -p data
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
FRED="SOFR IORB IOER RRPONTSYD RPONTSYD WALCL WTREGEN WRESBAL NFCI ANFCI GDP DRTSCILM SP500 VIXCLS VXVCLS PAYEMS SAHMREALTIME UNRATE CES0500000003 CCSA ICSA T10Y3M T10Y2Y DFII10 DFII5 T10YIE T5YIE DGS2 DGS10 DGS3MO DFF FEDFUNDS CPILFESL CPIAUCSL DCOILWTICO DTWEXBGS DTWEXM DEXJPUS DEXCHUS DTB3 BAMLH0A0HYM2 BAMLC0A0CM BAMLH0A0HYM2EY BAA AAA BAA10Y AAA10Y STLFSI4 KCFSI CFNAI USSLIND UMCSENT M2SL BUSLOANS TOTCI PERMIT HOUST TEMPHELPS INDPRO RSAFS NASDAQCOM WILL5000IND DRCCLACBS DRTSCLCC TOTALSL MORTGAGE30US PCOPPUSDM AMTMNO USREC JHDUSRGDPBR BOGZ1FL073164003Q NFCIRISK NFCILEVERAGE NFCICREDIT T10YFF CORESTICKM159SFRBATL"
echo "=== FRED ==="
for sid in $FRED; do
  url="https://fred.stlouisfed.org/graph/fredgraph.csv?id=${sid}&cosd=1950-01-01&coed=2026-12-31"
  curl -s -m 60 "$url" -o "data/${sid}.raw"
  sleep 0.3
  if [ -s "data/${sid}.raw" ] && head -1 "data/${sid}.raw" | grep -qi "date\|observation"; then
    awk -F, 'NR==1{print "date,value";next} $2!="." && $2!="" && $2!="NA"{print $1","$2}' "data/${sid}.raw" > "data/${sid}.csv"
    n=$(($(wc -l < "data/${sid}.csv")-1)); a=$(sed -n '2p' "data/${sid}.csv" | cut -d, -f1); b=$(tail -1 "data/${sid}.csv" | cut -d, -f1)
    printf "  %-22s %6s obs  %s .. %s\n" "$sid" "$n" "$a" "$b"
    rm -f "data/${sid}.raw"
  else
    printf "  %-22s FAIL\n" "$sid"; rm -f "data/${sid}.raw"
  fi
done
echo "=== Yahoo (5y chunks) ==="
declare -A Y=( ["GSPC"]="%5EGSPC" ["SP500TR"]="%5ESP500TR" ["BTCUSD"]="BTC-USD" ["GOLD"]="GC%3DF" ["RUT"]="%5ERUT" ["RSP"]="RSP" ["SMH"]="SMH" ["HYG"]="HYG" ["TLT"]="TLT" ["XLU"]="XLU" ["XLY"]="XLY" ["XLP"]="XLP" ["IWM"]="IWM" ["SPY"]="SPY" ["NDX"]="%5ENDX" ["VIX9D"]="%5EVIX9D" ["SKEW"]="%5ESKEW" ["MOVE"]="%5EMOVE" ["HG"]="HG%3DF" ["DXY"]="DX-Y.NYB")
for name in "${!Y[@]}"; do
  sym="${Y[$name]}"; : > "data/${name}.ndjson"; ok=0
  for y0 in 1985 1990 1995 2000 2005 2010 2015 2020 2025; do
    y1=$((y0+5)); p1=$(date -d "${y0}-01-01" +%s); p2=$(date -d "${y1}-01-01" +%s)
    for host in query1 query2; do
      url="https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?period1=${p1}&period2=${p2}&interval=1d"
      out=$(curl -s -m 60 -H "User-Agent: $UA" "$url")
      if echo "$out" | grep -q '"timestamp"'; then echo "$out" >> "data/${name}.ndjson"; ok=1; break; fi
      sleep 0.3
    done
    sleep 0.2
  done
  printf "  %-10s chunks_ok=%s bytes=%s\n" "$name" "$ok" "$(wc -c < data/${name}.ndjson)"
done
echo "done"
