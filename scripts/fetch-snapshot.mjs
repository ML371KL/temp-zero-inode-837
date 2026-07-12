/* ═══ Сейсмостанция «Разлом-26» · серверный сборщик снимка ═══
   Запускается расписанием GitHub Actions. Собирает те же данные, что страница
   тянула бы сама, и складывает в docs/snapshot.json под ЛОГИЧЕСКИМИ ключами
   (fred:SOFR, nyfed:rrp, fx:JPY, fh:news:MSFT …) — страница находит их через
   snapKey() и не делает ни одного внешнего запроса.
   Ключи: переменные окружения FRED_KEY и FINNHUB_KEY (секреты репозитория). */

import {writeFileSync, mkdirSync, readFileSync, existsSync} from "node:fs";

const FRED_KEY   = process.env.FRED_KEY   || "";
const FINNHUB_KEY= process.env.FINNHUB_KEY|| "";
const OUT        = process.env.OUT || "docs/snapshot.json";

/* тот же список серий и глубин, что в странице (SERIES_LIMITS) */
const SERIES={SOFR:40,IORB:40,WALCL:90,WTREGEN:90,WRESBAL:90,
  BAMLH0A0HYM2:520,BAMLC0A0CM:520,SP500:280,VIXCLS:520,SAHMREALTIME:30,CCSA:90,
  T10Y3M:430,DFII10:160,T10YIE:110,DCOILWTICO:140,DGS2:160,CPILFESL:20,CES0500000003:20,
  PAYEMS:20,DTWEXBGS:160,NFCI:120,DRTSCILM:60,GDP:12,DGS10:170,VXVCLS:170};
/* ленивые резервы — добираются, если упал первичный путь */
const LAZY={RRPONTSYD:300,RPONTSYD:20,DEXJPUS:70,DEXCHUS:70,UNRATE:30};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJSON(url,tries=3){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{signal:AbortSignal.timeout(15000),
        headers:{"User-Agent":"razlom26-snapshot/1.0"}});
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.json();
    }catch(e){last=e; await sleep(1200*(i+1));}
  }
  throw last;
}

async function getTEXT(url,tries=3){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{"User-Agent":"razlom26-snapshot/1.0"}});
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.text();
    }catch(e){last=e; await sleep(1000*(i+1));}
  }
  throw last;
}

const R={};                     /* responses под логическими ключами */
const failed=[];
/* валидатор формы: пустой/битый ответ = сбой источника, а не «успех» */
function valid(key,j){
  if(key.startsWith("stqd:")) return typeof j==="string"&&j.trim().split(/\r?\n/).length>10; /* дневная история CSV */
  if(key.startsWith("stq:")) return typeof j==="string"&&j.split(",").length>=7; /* интрадей — CSV-строка */
  if(!j||typeof j!=="object") return false;
  if(key.startsWith("fred:"))   return Array.isArray(j.observations)&&j.observations.length>3;
  if(key.startsWith("fx:"))     return j.rates&&Object.keys(j.rates).length>10;
  if(key.startsWith("cg:"))     return Array.isArray(j.prices)&&j.prices.length>5;
  if(key.startsWith("bin:"))    return Array.isArray(j)&&j.length>5;
  if(key==="nyfed:rrp"||key==="nyfed:srf")
    return !!(((j.repo||{}).operations||j.operations||[]).length);
  if(key==="nyfed:sofr")        return Array.isArray(j.refRates)&&j.refRates.length>2;
  if(key==="fiscal:tga")        return Array.isArray(j.data)&&j.data.length>20;
  if(key.startsWith("fh:news")) return Array.isArray(j);
  if(key==="fh:general")        return Array.isArray(j)&&j.length>3;
  if(key.startsWith("fh:quote"))return typeof j.c==="number"&&j.c>0;
  return true;
}
async function put(key,fn){
  try{
    const j=await fn();
    if(!valid(key,j)) throw new Error("битая форма ответа");
    R[key]=j;
  }catch(e){ failed.push(key+" — "+(e&&e.message||e)); }
}

const iso=d=>d.toISOString().slice(0,10);
const fredURL=(s,lim)=>`https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=${lim}`;

async function main(){
  if(!FRED_KEY) throw new Error("нет секрета FRED_KEY");

  /* ── FRED: параллельно пачками по 4 ── */
  const fredList=Object.entries(SERIES);
  for(let i=0;i<fredList.length;i+=4)
    await Promise.all(fredList.slice(i,i+4).map(([s,l])=>put("fred:"+s,()=>getJSON(fredURL(s,l)))));

  /* ── NY Fed ── */
  await put("nyfed:rrp", ()=>getJSON("https://markets.newyorkfed.org/api/rp/reverserepo/all/results/last/320.json"));
  await put("nyfed:srf", ()=>getJSON("https://markets.newyorkfed.org/api/rp/repo/all/results/last/6.json"));
  await put("nyfed:sofr",()=>getJSON("https://markets.newyorkfed.org/api/rates/secured/sofr/last/10.json"));

  /* ── Минфин (дневная касса) ── */
  await put("fiscal:tga",()=>getJSON("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?fields=record_date,account_type,open_today_bal&filter=account_type:in:(Treasury%20General%20Account%20(TGA)%20Closing%20Balance)&sort=-record_date&page[size]=260"));

  /* ── Крипто/золото: CoinGecko, резерв Binance ── */
  await put("cg:bitcoin", ()=>getJSON("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily"));
  await put("cg:pax-gold",()=>getJSON("https://api.coingecko.com/api/v3/coins/pax-gold/market_chart?vs_currency=usd&days=35&interval=daily"));
  if(!R["cg:bitcoin"])  await put("bin:BTCUSDT", ()=>getJSON("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=91"));
  if(!R["cg:pax-gold"]) await put("bin:PAXGUSDT",()=>getJSON("https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1d&limit=36"));
  /* с раннеров GitHub (США) Binance отвечает 451 — третий эшелон: дневная история Stooq */
  const stooqDaily=async sym=>{
    const csv=await getTEXT("https://stooq.com/q/d/l/?s="+sym+"&i=d");
    const lines=String(csv).trim().split(/\r?\n/);
    if(lines.length<10) throw new Error("битая форма ответа");
    return [lines[0],...lines.slice(-100)].join("\n");   /* полная история xauusd — десятилетия; храним хвост */
  };
  if(!R["cg:bitcoin"]&&!R["bin:BTCUSDT"])   await put("stqd:btcusd", ()=>stooqDaily("btcusd"));
  if(!R["cg:pax-gold"]&&!R["bin:PAXGUSDT"]) await put("stqd:xauusd",()=>stooqDaily("xauusd"));

  /* ── Валюты: Frankfurter (два хоста), резерв FRED H.10 ── */
  const end=iso(new Date()), start=iso(new Date(Date.now()-100*864e5));
  for(const cur of ["JPY","CNY"]){
    await put("fx:"+cur, async()=>{
      try{
        const j=await getJSON(`https://api.frankfurter.dev/v1/${start}..${end}?base=USD&symbols=${cur}`);
        if(j&&j.rates&&Object.keys(j.rates).length>10) return j; throw new Error("пустой dev");
      }catch(e){ return await getJSON(`https://api.frankfurter.app/${start}..${end}?from=USD&to=${cur}`); }
    });
    if(!R["fx:"+cur]) await put("fred:"+(cur==="JPY"?"DEXJPUS":"DEXCHUS"),
      ()=>getJSON(fredURL(cur==="JPY"?"DEXJPUS":"DEXCHUS",(cur==="JPY"?LAZY.DEXJPUS:LAZY.DEXCHUS))));
  }

  /* ── резервы каскадов, если первичный путь упал ── */
  if(!R["nyfed:rrp"]) await put("fred:RRPONTSYD",()=>getJSON(fredURL("RRPONTSYD",LAZY.RRPONTSYD)));
  if(!R["nyfed:srf"]) await put("fred:RPONTSYD", ()=>getJSON(fredURL("RPONTSYD", LAZY.RPONTSYD)));
  if(!R["fred:SAHMREALTIME"]) await put("fred:UNRATE",()=>getJSON(fredURL("UNRATE",LAZY.UNRATE)));

  /* ── Finnhub: новости и котировки (если задан ключ) ── */
  if(FINNHUB_KEY){
    const from=iso(new Date(Date.now()-14*864e5)), to=iso(new Date());
    const syms=["MSFT","GOOGL","AMZN","META","ORCL","ARCC","OBDC","FSK","BXSL","GBDC","MFIC"];
    const slim=a=>(Array.isArray(a)?a:[]).map(n=>({headline:n.headline,url:n.url,datetime:n.datetime}));
    for(const s of syms)
      await put("fh:news:"+s,async()=>slim(await getJSON(`https://finnhub.io/api/v1/company-news?symbol=${s}&from=${from}&to=${to}&token=${FINNHUB_KEY}`)).slice(0,120));
    await put("fh:general",async()=>slim(await getJSON(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`)).slice(0,80));
    for(const s of ["BIZD","SMH","SPY","RSP"])
      await put("fh:quote:"+s,()=>getJSON(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB_KEY}`));
  }

  /* ── Интрадей Stooq (без ключей): WTI-фьючерс, VIX, USD/JPY ── */
  for(const sym of ["cl.f","^vix","usdjpy"]){
    await put("stq:"+sym, async()=>{
      const csv=await getTEXT("https://stooq.com/q/l/?s="+encodeURIComponent(sym)+"&f=sd2t2ohlcv&h&e=csv");
      const c=String(csv).trim().split(/\r?\n/).pop().split(",");
      if(c.length<7||!(+c[6]>0)) throw new Error("битая форма ответа");
      return csv;
    });
  }

  /* ── слияние с последним удачным снимком: сбой источника ≠ дырка на сайте ── */
  const stale_keys={};
  try{
    if(existsSync(OUT)){
      const prev=JSON.parse(readFileSync(OUT,"utf-8"));
      const failedKeys=failed.map(f=>String(f).split(" — ")[0]);
      for(const k of failedKeys){
        const prevAge=Date.now()-new Date(prev.generated_at).getTime();
        if(k.startsWith("fh:")&&prevAge>3*86400e3) continue;  /* новости старше 3 суток не подкладываем: окно детекторов 14 дн. */
        if(prev&&prev.responses&&prev.responses[k]!==undefined&&R[k]===undefined){
          R[k]=prev.responses[k];
          stale_keys[k]=(prev.stale_keys&&prev.stale_keys[k])||prev.generated_at;
          const i=failed.findIndex(f=>String(f).startsWith(k+" "));
          if(i>=0) failed[i]+=" (подложено из снимка "+String(stale_keys[k]).slice(0,16)+")";
        }
      }
    }
  }catch(e){console.log("merge с прошлым снимком пропущен:",String(e&&e.message||e));}

  /* ── запись ── */
  mkdirSync(OUT.split("/").slice(0,-1).join("/")||".",{recursive:true});
  const fredOk=Object.keys(R).filter(k=>k.startsWith("fred:")).length;
  writeFileSync(OUT,JSON.stringify({generated_at:new Date().toISOString(),
    ok:Object.keys(R).length, failed, stale_keys,
    meta:{symbols:["MSFT","GOOGL","AMZN","META","ORCL","ARCC","OBDC","FSK","BXSL","GBDC","MFIC"]},
    responses:R}));
  console.log(`снимок: ${Object.keys(R).length} источников (fred: ${fredOk}), сбоев: ${failed.length}`);
  failed.forEach(f=>console.log("  ! "+f));
  if(fredOk<18) { console.error("критично мало серий FRED — помечаю запуск неудачным"); process.exit(1); }
}
main().catch(e=>{console.error("сборщик упал:",e);process.exit(1);});
