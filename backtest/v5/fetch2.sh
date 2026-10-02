#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
FRED="VXOCLS VXNCLS GACDFSA066MSFRBPHI GACDISA066MSFRBNY NOCDFSA066MSFRBPHI MICH BAMLHYH0A0HYM2TRIV BAMLCC0A0CMTRIV DEXUSEU TOTRESNS M2REAL WLEMUINDXD IC4WSA DGS30 DGS5 T5YIFR JTSJOL JTSQUR CSCICP03USM665S BSCICP03USM665S AWHMAN NEWORDER ACOGNO DGORDER USRECD NFCINONFINLEVERAGE RECPROUSM156N MANEMP CIVPART USALOLITONOSTSAM USALOLITOAASTSAM DEXUSUK DCOILBRENTEU TB3MS AAA10YM BAMLH0A0HYM2EY BAMLC0A4CBBB BAMLH0A3HYC BAMLEMCBPIOAS DRSFRMACBS DRALACBS TOTBKCR EXPINF1YR EXPINF10YR"
echo "=== FRED-2 ==="
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
echo "done2"
