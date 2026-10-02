/* ═══ Монитор рынка США · серверный сборщик снимка ═══
   Запускается расписанием GitHub Actions. Собирает те же данные, что страница
   тянула бы сама, и складывает в docs/snapshot.json под ЛОГИЧЕСКИМИ ключами
   (fred:SOFR, nyfed:rrp, fx:JPY, fh:news:MSFT …) — страница находит их через
   snapKey() и не делает ни одного внешнего запроса.
   Ключи: переменные окружения FRED_KEY и FINNHUB_KEY (секреты репозитория). */

import {writeFileSync, mkdirSync, readFileSync, existsSync} from "node:fs";

const FRED_KEY   = process.env.FRED_KEY   || "";
const FINNHUB_KEY= process.env.FINNHUB_KEY|| "";
/* v4.10: серверный LLM-судья новостных кандидатов (опционально). Секрет OPENROUTER_KEY →
   каждый прогон дешёвая модель классифицирует НОВЫЕ жёсткие кандидаты (факт/мнение),
   вердикты кэшируются в снимке (fh:newsVer) — страница получает проверенные факты
   без ИИ-ключа во вкладке. Кандидатов обычно 0–3 за прогон ≈ доли цента. */
const OPENROUTER_KEY  = process.env.OPENROUTER_KEY  || "";
const OPENROUTER_MODEL= process.env.OPENROUTER_MODEL|| "anthropic/claude-haiku-4.5";
const OUT        = process.env.OUT || "docs/snapshot.json";
/* v4.13.3: состав корзин извлекается из картриджа CYCLE клиента (docs/index.html) — единый
   источник истины: смена цикла правится в одном месте. При сбое извлечения — зашитый резерв. */
const {CAPEX_TICKERS,BDC_TICKERS}=(()=>{
  const fb={CAPEX_TICKERS:["MSFT","GOOGL","AMZN","META","ORCL","CRWV"],
            BDC_TICKERS:["ARCC","OBDC","FSK","BXSL","GBDC","MFIC"]};
  try{
    const page=readFileSync("docs/index.html","utf-8");
    const g=n=>JSON.parse(page.match(new RegExp(n+":\\s*(\\[[^\\]]*\\])"))[1]);
    const c=g("capexTickers"), b=g("bdcTickers");
    const okArr=a=>Array.isArray(a)&&a.length>=1&&a.every(t=>typeof t==="string"&&/^[A-Z][A-Z0-9.\-]{0,7}$/.test(t));
    if(!okArr(c)||!okArr(b)) throw new Error("картридж не распознан");
    return {CAPEX_TICKERS:c,BDC_TICKERS:b};
  }catch(e){
    console.log("картридж CYCLE не извлечён ("+String(e&&e.message||e)+") — зашитый резерв");
    return fb;
  }
})();
const NEWS_SYMBOLS=[...CAPEX_TICKERS,...BDC_TICKERS];
/* v4.9: грубый серверный префильтр релевантности (шире клиентских RX: NEG/OP/LLM-суд остаются клиенту).
   Совпавшие заголовки копятся отдельным слоем fh:newsHit:SYM с 14-дневным окном и слиянием между
   запусками — иначе у гиперскейлеров фон ~90 заголовков/день выталкивает событие из хвоста 120
   за сутки, и «14-дневное окно» детекторов существовало только на бумаге. */
/* ⚠ HIT_RX обязан быть НАДМНОЖЕСТВОМ клиентских словарей (ядро ⟦NEWS-CORE⟧ в index.html) и
   побайтово равен клиентской копии — оба условия проверяет scripts/news-test.mjs.
   v5.0: + force majeure / stargate / ai campus / ai factory / bankrupt / chapter 11 / tender /
   wrote down — новые формы событий (форс-мажор Oracle 24.09 префильтр пропускал, если в
   заголовке не было «data center»). */
const HIT_RX=/capex|capital expenditure|capital spending|data ?cent|ai infrastructure|gpu|server|chip|spend|investment|depreciat|useful li(fe|ves)|impairment|writ(e|es|ten|ing)?[ -]?downs?|wrote[ -]?down|force majeure|stargate|ai (mega-?)?campus|ai factor|bankrupt|chapter 11|dividend|distribution|payout|redemption|withdrawal|tender|exodus|outflow\w*|\bgat(e|es|ed|ing)\b|non[- ]?accrual|navs?\b|default rate|pik/i;

/* тот же список серий и глубин, что в странице (SERIES_LIMITS) */
const SERIES={SOFR:40,IORB:40,WALCL:90,WTREGEN:90,WRESBAL:90,
  BAMLH0A0HYM2:520,BAMLC0A0CM:520,SP500:280,VIXCLS:520,SAHMREALTIME:30,CCSA:90,
  T10Y3M:430,DFII10:160,T10YIE:110,DCOILWTICO:300,DGS2:160,CPILFESL:26,CES0500000003:26,
  PAYEMS:20,DTWEXBGS:160,NFCI:120,DRTSCILM:60,GDP:12,DGS10:170,VXVCLS:170,
  THREEFYTP10:160,WMTSECL1:60,FORLTTOTALNET99996:40,CFNAI:40,
  DFEDTARU:40,BAMLH0A3HYC:520,BAMLH0A1HYBB:520}; /* CPI/зарплаты 26: запас на дыры ряда при расчёте г/г по датам;
  v4.15: срочная премия Kim-Wright, кастодия ФРС для иностранных ЦБ, TIC чистые покупки, CFNAI — справочный блок «контекст»;
  v5.0: DCOILWTICO 140 → 300 — нефть меряется отношением к своей средней за год (нужно ≥252 торговых дня);
  DFEDTARU — верх коридора ставки ФРС для карточки «путь ФРС» (2-летка минус ставка);
  BAMLH0A3HYC/BAMLH0A1HYBB — спреды CCC и BB для справочной карточки расслоения кредита */
/* v4.15: бесключевые источники справочного блока — CFTC (Socrata JSON, спекулятивная позиция в E-mini S&P,
   ~3,3 года недельных отчётов) и CBOE (CSV подразумеваемой корреляции COR1M). Оба без ключей и без CORS-проблем
   на сервере; страница читает их из снимка по ключам cftc:es и cboe:cor1m (см. snapKey в index.html). */
const CFTC_ES_URL="https://publicreporting.cftc.gov/resource/6dca-aqww.json?market_and_exchange_names=E-MINI%20S%26P%20500%20-%20CHICAGO%20MERCANTILE%20EXCHANGE&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=170&$select=report_date_as_yyyy_mm_dd,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all";
const CBOE_COR1M_URL="https://cdn.cboe.com/api/global/us_indices/daily_prices/COR1M_History.csv";
/* ленивые резервы — добираются, если упал первичный путь */
/* v5.0: резерв SRF — RPONTTLD (все виды обеспечения), а не RPONTSYD (только казначейские): в стрессовые
   дни заметная часть обращений идёт под MBS — 31.10.2025 это 50,35 против 29,4 млрд */
const LAZY={RRPONTSYD:300,RPONTTLD:20,DEXJPUS:70,DEXCHUS:70,UNRATE:30};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* v4.13.4: глобальный дедлайн сборки. Воркфлоу обрубается на 15-й минуте БЕЗ коммита —
   один зависший источник с полными ретраями терял всю сборку.
   v4.13.5 (гранд-аудит): 11 минут не сходились с бюджетами. Во-первых, после дедлайна
   оставался хвост коротких попыток (~40 запросов × 8 с ≈ 5–6 мин) при бюджете 15−11 ≈ 3,5 мин
   до timeout-minutes — узел всё равно умирал без коммита, т.е. ровно тот отказ, который
   правка должна была снять. Во-вторых, в быстрой полосе (такт 10 мин) concurrency
   cancel-in-progress отменял затянувшийся прогон РАНЬШЕ 11-й минуты — механизм не успевал
   включиться вовсе. Теперь дедлайн 8 минут и он жёсткий: за ним источники не добираются, а
   ПРОПУСКАЮТСЯ (put() сразу пишет их в failed) — их значения подкладывает merge из прошлого
   снимка, и сборка публикует то, что успела, к ~8-й минуте. Хвост нулевой: укладываемся и в
   10-минутный такт, и в 15-минутный таймаут. Здоровый прогон занимает ~30 с — дедлайна не
   видит никогда. */
const T0=Date.now(), DEADLINE_MS=8*60*1000;
const late=()=>Date.now()-T0>DEADLINE_MS;
async function getJSON(url,tries=3,hdrs){
  let last;
  if(late()) tries=1;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{signal:AbortSignal.timeout(late()?8000:15000),
        headers:hdrs||{"User-Agent":"razlom26-snapshot/1.0"}});
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.json();
    }catch(e){last=e; if(i<tries-1) await sleep(1200*(i+1));}
  }
  throw last;
}

async function getTEXT(url,tries=3){
  let last;
  if(late()) tries=1;                                    /* v4.13.4: см. дедлайн выше */
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{signal:AbortSignal.timeout(late()?8000:12000),headers:{"User-Agent":"razlom26-snapshot/1.0"}});
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.text();
    }catch(e){last=e; if(i<tries-1) await sleep(1000*(i+1));}
  }
  throw last;
}

/* ── Yahoo v8 chart: рабочая лошадка интрадея и крипто-резерва ──
   Балансируется между query1/query2; требует браузерный User-Agent.
   Ответ нормализуем в ЛЕГАСИ-CSV формата Stooq: клиент читает те же ключи
   тем же парсером — ни одна строка страницы не меняется. */
/* v4.9: Windows-UA вместо X11/Linux — Yahoo стал отдавать 404/429 на «линуксовые» UA с
   датацентровых IP (подтверждено сутками stq:cl.f/usdjpy в failed); с Windows-UA проходит */
const YUA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
           "Accept":"application/json"};
async function yahooChart(sym,range,interval){
  let last;
  for(const host of ["query1","query2"]){
    try{
      const j=await getJSON(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`,2,YUA);
      const r=j&&j.chart&&j.chart.result&&j.chart.result[0];
      if(r) return r;
      throw new Error("пустой chart");
    }catch(e){last=e;}
  }
  throw last||new Error("yahoo недоступен");
}
const isoD=t=>new Date(t*1000).toISOString().slice(0,10);
async function yahooQuoteCSV(ySym,legacySym,lo,hi){       /* одна строка-котировка в форме Stooq q/l */
  const r=await yahooChart(ySym,"5d","1d");
  let px=r.meta&&r.meta.regularMarketPrice, t=r.meta&&r.meta.regularMarketTime;
  if(!(px>0)){ const c=(r.indicators&&r.indicators.quote&&r.indicators.quote[0]&&r.indicators.quote[0].close)||[];
    for(let i=c.length-1;i>=0;i--) if(c[i]>0){px=c[i];t=r.timestamp[i];break;} }
  if(!(px>lo&&px<hi&&t>0)) throw new Error("вне диапазона/пусто");
  return "Symbol,Date,Time,Open,High,Low,Close,Volume\n"
        +legacySym.toUpperCase()+","+isoD(t)+",00:00:00,"+px+","+px+","+px+","+px+",0";
}
async function yahooDailyCSV(ySym,days){                  /* дневная история в форме Stooq q/d/l */
  const r=await yahooChart(ySym,"6mo","1d");
  const ts=r.timestamp||[], cl=(r.indicators&&r.indicators.quote&&r.indicators.quote[0]&&r.indicators.quote[0].close)||[];
  const rows=["Date,Open,High,Low,Close,Volume"];
  for(let i=0;i<ts.length;i++){const v=cl[i]; if(v>0) rows.push(isoD(ts[i])+","+v+","+v+","+v+","+v+",0");}
  if(rows.length<10) throw new Error("битая форма ответа");
  return [rows[0],...rows.slice(1).slice(-days)].join("\n");
}

const R={};                     /* responses под логическими ключами */
const failed=[];
/* валидатор формы: пустой/битый ответ = сбой источника, а не «успех» */
function valid(key,j){
  if(key.startsWith("stqd:")) return typeof j==="string"&&j.trim().split(/\r?\n/).length>10; /* дневная история CSV */
  if(key.startsWith("stq:")) return typeof j==="string"&&j.split(",").length>=7; /* интрадей — CSV-строка */
  if(key==="cboe:cor1m")        return typeof j==="string"&&j.trim().split(/\r?\n/).length>260&&/^DATE,/i.test(j.trim()); /* v4.15: CSV-строка, ≥ год дневных точек — ДО отсечения «не объект» */
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
  if(key.startsWith("ydiv:"))   return Array.isArray(j)&&j.length>=5;  /* клиентской ноге нужно >=5 */
  if(key.startsWith("ypx:"))    return Array.isArray(j)&&j.length>=150&&j.every(r=>Array.isArray(r)&&r.length===3&&r[1]>0); /* v5.0: год дневных закрытий */
  if(key.startsWith("fh:quote"))return typeof j.c==="number"&&j.c>0;
  if(key==="cftc:es")           return Array.isArray(j)&&j.length>=52&&j.every(r=>r&&r.report_date_as_yyyy_mm_dd&&+r.open_interest_all>0); /* v4.15: ≥1 год недельных отчётов */
  return true;
}
async function put(key,fn){
  /* v4.13.5: за дедлайном источник не добирается вовсе — попадает в failed, где его значение
     подкладывает merge из прошлого снимка (капы 3/7/45 сут.). Так сборка гарантированно
     доходит до записи и коммита, а недобор чинит следующий прогон через 10–20 минут. */
  if(late()){ failed.push(key+" — пропущен: дедлайн сборки ("+Math.round((Date.now()-T0)/1000)+" с)"); return; }
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
  /* v4.15: справочный блок «контекст» — позиционирование и корреляция (без ключей) */
  await put("cftc:es",()=>getJSON(CFTC_ES_URL));
  await put("cboe:cor1m",async()=>{
    const t=String(await getTEXT(CBOE_COR1M_URL)).trim();
    const lines=t.split(/\r?\n/);                       /* полная история с 2006 — ~5 200 строк; в снимке держим ~1,5 года */
    return [lines[0],...lines.slice(-400)].join("\n");
  });

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
  const cryptoDailyCSV=async(ySym,stSym)=>{
    await sleep(600+Math.random()*900);
    try{ return await yahooDailyCSV(ySym,100); }            /* Yahoo: работает с раннеров, где Binance=451, Stooq=блок */
    catch(e){ return await stooqDaily(stSym); }
  };
  if(!R["cg:bitcoin"]&&!R["bin:BTCUSDT"])   await put("stqd:btcusd", ()=>cryptoDailyCSV("BTC-USD","btcusd"));
  if(!R["cg:pax-gold"]&&!R["bin:PAXGUSDT"]) await put("stqd:xauusd",async()=>{
    await sleep(600+Math.random()*900);
    try{ return await yahooDailyCSV("PAXG-USD",100); }        /* тот же актив, что первичный путь карточки — без роллов GC=F */
    catch(e){ try{ return await yahooDailyCSV("GC=F",100); }
      catch(e2){ return await stooqDaily("xauusd"); } }
  });

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
  if(!R["nyfed:srf"]) await put("fred:RPONTTLD", ()=>getJSON(fredURL("RPONTTLD", LAZY.RPONTTLD)));
  if(!R["fred:SAHMREALTIME"]) await put("fred:UNRATE",()=>getJSON(fredURL("UNRATE",LAZY.UNRATE)));

  /* ── Finnhub: новости и котировки (если задан ключ) ──
     v4.9: секция general-новостей (гео/тарифы) удалена — на балл не влияла;
     добавлен слой fh:newsHit:SYM — все релевантные заголовки за 14 дней с
     накоплением между запусками (дедуп по url+datetime).
     v4.10: slim сохраняет source (клиент различает мнение-источники);
     жёсткие кандидаты собираются для серверного LLM-судьи. */
  let prevSnap=null;
  try{ if(existsSync(OUT)) prevSnap=JSON.parse(readFileSync(OUT,"utf-8")); }catch(e){}
  /* v5.0: ядро сканера исполняется ЦЕЛИКОМ со страницы — блок ⟦NEWS-CORE⟧…⟦/NEWS-CORE⟧ из
     docs/index.html (кандидаты по клаузам, атрибуция компании по алиасам, якоря, промпт и разбор
     ответа судьи). v4.13.5 выдирал отдельные регэкспы по шаблонам строк — схема ломалась от
     любой перестройки словарей, а рукописная копия расходилась с оригиналом. Корзины — те же,
     что выше из картриджа CYCLE. Сбой извлечения → кандидатов нет, судья пропускается, слой
     fh:newsHit (HIT_RX ниже) собирается как обычно. */
  const CL=(()=>{
    try{
      const page=readFileSync("docs/index.html","utf-8").replace(/\r\n/g,"\n");
      const m=page.match(/\/\* ⟦NEWS-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/NEWS-CORE⟧ \*\//);
      if(!m) throw new Error("нет блока ⟦NEWS-CORE⟧");
      const core=new Function("CONFIG",m[1]+"\nreturn {newsMatch,judgePrompt,parseJudge,JUDGE_SYS,VER_TTL};")
        ({CYCLE:{capexTickers:CAPEX_TICKERS,bdcTickers:BDC_TICKERS}});
      if(typeof core.newsMatch!=="function") throw new Error("ядро без newsMatch");
      return core;
    }catch(e){console.log("извлечение ядра сканера не удалось:",String(e&&e.message||e));return null;}
  })();
  const CAND=[];                                       /* кандидаты для LLM-судьи: {h,kind:"C"|"B",sym,t} */
  let LLM_JUDGED=0;                                    /* рассужено в ЭТОМ прогоне (для meta.llm) */
  if(FINNHUB_KEY){
    const from=iso(new Date(Date.now()-14*864e5)), to=iso(new Date());
    const syms=NEWS_SYMBOLS;
    const slim=a=>(Array.isArray(a)?a:[]).map(n=>({headline:n.headline,url:n.url,datetime:n.datetime,source:n.source||""}));
    const cutoff=Date.now()/1000-14*86400;
    for(const s of syms)
      await put("fh:news:"+s,async()=>{
        const full=slim(await getJSON(`https://finnhub.io/api/v1/company-news?symbol=${s}&from=${from}&to=${to}&token=${FINNHUB_KEY}`));
        /* релевантный слой: свежие совпадения + унаследованные из прошлого снимка, окно 14 дн. */
        const prevHit=(prevSnap&&prevSnap.responses&&prevSnap.responses["fh:newsHit:"+s])||[];
        const seen=new Set();
        const hits=[...full.filter(n=>HIT_RX.test(n.headline||"")),...prevHit]
          .filter(n=>(n.datetime||0)>cutoff)
          .filter(n=>{const k=(n.url||n.headline||"")+"|"+(n.datetime||0);if(seen.has(k))return false;seen.add(k);return true;})
          .sort((a,b)=>(b.datetime||0)-(a.datetime||0)).slice(0,400);
        R["fh:newsHit:"+s]=hits;                       /* пишем слой напрямую: valid() к нему не применяем */
        /* v5.0: оба словаря по любой ленте — компанию события называет заголовок (newsMatch держит
           кандидата без компании корзины только в ленте своей корзины, как и страница) */
        if(CL) hits.forEach(n=>{const h=n.headline||"";const m=CL.newsMatch(h,[s],n.source||"");
          if(m.capex||m.bdc) CAND.push({h,kind:m.capex?"C":"B",sym:(m.capex||m.bdc).sym,t:n.datetime||0});});
        return full.slice(0,120);                      /* фон для ленты — как раньше */
      });
    for(const s of ["BIZD","SMH","SPY","RSP"])
      await put("fh:quote:"+s,()=>getJSON(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${FINNHUB_KEY}`));
  }

  /* ── дивидендная data-нога BDC-детектора (v4.11): история выплат из Yahoo (events=div) ──
     Срезку дивиденда клиент вычисляет ИЗ ДАННЫХ (последняя выплата < модальной за 4 прежних),
     независимо от новостей и LLM — детерминированная вторая нога детектора. */
  for(const s of BDC_TICKERS){                           /* BDC-корзина из картриджа */
    await sleep(400+Math.random()*600);
    await put("ydiv:"+s,async()=>{
      const j=await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=2y&interval=1mo&events=div`,2,YUA);
      const ev=j&&j.chart&&j.chart.result&&j.chart.result[0]&&j.chart.result[0].events;
      const list=ev&&ev.dividends?Object.values(ev.dividends).filter(x=>x&&x.amount>0&&x.date>0)
        .sort((a,b)=>a.date-b.date).map(x=>[x.date,x.amount]).slice(-10):[];
      if(list.length<5) throw new Error("мало точек ("+list.length+")");
      return list;
    });
  }

  /* ── v5.0: цена самой ставки — дневные закрытия корзин капекса и BDC за год (Yahoo, с поправкой на
     дивиденды: adjclose). Радары-детекторы видят события и забывают их через 14/45 дней; цена носителей
     ставки помнит всё: просадка от пика, доля бумаг ниже 200-дневной, относительная доходность против
     S&P. BIZD здесь же — его дневное изменение по полной доходности не рисует ложный «обвал» в
     экс-дивидендные даты. Справочный слой: в балл не идёт. */
  for(const s of [...CAPEX_TICKERS,...BDC_TICKERS,"BIZD","SPY"]){
    await sleep(300+Math.random()*500);
    await put("ypx:"+s,async()=>{
      const r=await yahooChart(s,"1y","1d");
      const ts=r.timestamp||[], q=(r.indicators&&r.indicators.quote&&r.indicators.quote[0])||{};
      const adj=(r.indicators&&r.indicators.adjclose&&r.indicators.adjclose[0]&&r.indicators.adjclose[0].adjclose)||[];
      const out=[];
      for(let i=0;i<ts.length;i++){ const c=q.close&&q.close[i], a=adj[i]; if(c>0) out.push([ts[i],+c.toFixed(4),+(a>0?a:c).toFixed(4)]); }
      if(out.length<150) throw new Error("мало точек ("+out.length+")");
      return out;
    });
  }

  /* ── серверный LLM-судья кандидатов ──
     fh:newsVer: [заголовок, "fact"|"opinion"|"unverified", tсуда, subject, type]; старые записи
     [h,"fact"|"opinion",t] страница читает как есть (subject нет → атрибуция по алиасам).
     v5.0: судья возвращает класс, компанию-подлежащее (тикер корзины или "none") и тип события;
     ленту ему НЕ сообщаем — именно она путала атрибуцию. Отказ («opinion»/«unverified») живёт в
     кэше 3 суток, факт — всё 14-дневное окно: одна ошибка free-модели больше не немит заголовок
     на всё окно. Первыми судятся кандидаты с компанией корзины (они двигают порог), затем свежие. */
  {
    const nowSec=Math.floor(Date.now()/1000);
    const ttl=(CL&&CL.VER_TTL)||{fact:14*86400,neg:3*86400};
    const prevVer=((prevSnap&&prevSnap.responses&&prevSnap.responses["fh:newsVer"])||[])
      .filter(e=>Array.isArray(e)&&e.length>=3&&e[2]>nowSec-(e[1]==="fact"?ttl.fact:ttl.neg));
    const known=new Map(prevVer.map(e=>[e[0],e]));
    const fresh=[]; const seenH=new Set();
    for(const c of CAND.slice().sort((a,b)=>(!!b.sym-!!a.sym)||((b.t||0)-(a.t||0))))
      if(!known.has(c.h)&&!seenH.has(c.h)){seenH.add(c.h);fresh.push(c);}
    if(OPENROUTER_KEY&&fresh.length&&!late()){        /* v4.13.5: за дедлайном судья ждёт следующей сборки — вердикты кэша не теряются */
      try{
        const batch=fresh.slice(0,40), rows=batch.map((c,i)=>[c.kind+i,c.h]);
        const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",
          headers:{"Content-Type":"application/json","Authorization":"Bearer "+OPENROUTER_KEY,"X-Title":"Razlom-26 snapshot"},
          body:JSON.stringify({model:OPENROUTER_MODEL,max_tokens:4000,messages:[{role:"system",content:CL.JUDGE_SYS},{role:"user",content:CL.judgePrompt(rows)}]}),
          signal:AbortSignal.timeout(late()?30000:90000)});  /* v4.13.4: за дедлайном судья ждёт меньше — кандидаты досудит следующая сборка */
        if(!r.ok) throw new Error("HTTP "+r.status);
        const j=await r.json();
        const txt=((j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||"").trim();
        /* v4.12/v4.13.4: reasoning-модели пишут {...} в рассуждениях и цитируют пример формата —
           parseJudge берёт плоские объекты по id и при повторе id — ПОСЛЕДНИЙ */
        const got=CL.parseJudge(txt,rows.map(x=>x[0]));
        if(!got.size) throw new Error("нет JSON");
        batch.forEach((c,i)=>{const v=got.get(c.kind+i);    /* не вернувшийся в ответе — досудится следующей сборкой */
          if(v) known.set(c.h,v.subject?[c.h,v.cls,nowSec,v.subject,v.type]:[c.h,v.cls,nowSec]);});
        LLM_JUDGED=got.size;
        console.log("LLM-судья: рассужено "+LLM_JUDGED+" из "+batch.length+" новых кандидатов ("+OPENROUTER_MODEL+")");
      }catch(e){ failed.push("fh:newsVer — LLM-судья: "+(e&&e.message||e)+" (кэш вердиктов сохранён)"); }
    } else if(fresh.length){ console.log("LLM-судья пропущен (нет OPENROUTER_KEY): несуженных кандидатов "+fresh.length+" — страница классифицирует правилами/своим ключом"); }
    if(known.size||CAND.length) R["fh:newsVer"]=[...known.values()];
  }

  /* ── Интрадей Stooq (без ключей): WTI-фьючерс, VIX, USD/JPY ── */
  async function cboeVixCSV(){                    /* официальный delayed-CDN CBOE; поля парсим защитно */
    const j=await getJSON("https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json",2,YUA);
    const d=(j&&j.data)||{};
    const px=[d.current_price,d.last,d.close,d.price,d.last_price].find(v=>typeof v==="number"&&v>0);
    if(!(px>5&&px<150)) throw new Error("CBOE: вне диапазона/форма");
    const raw=String(d.last_trade_time||d.timestamp||"");
    const day=/^\d{4}-\d{2}-\d{2}/.test(raw)? raw.slice(0,10) : new Date().toISOString().slice(0,10);
    return "Symbol,Date,Time,Open,High,Low,Close,Volume\n^VIX,"+day+",00:00:00,"+px+","+px+","+px+","+px+",0";
  }
  const IQ={ "cl.f":{y:"CL=F",lo:15,hi:300}, "^vix":{y:"^VIX",lo:5,hi:150}, "usdjpy":{y:"JPY=X",lo:80,hi:250} };
  for(const sym of Object.keys(IQ)){
    await sleep(700+Math.random()*1300);            /* залп с одного IP — худший паттерн для троттлинга */
    await put("stq:"+sym, async()=>{
      const q=IQ[sym];
      if(sym==="^vix"){ try{ return await cboeVixCSV(); }catch(e){} }    /* эшелон 0 (VIX): официальный CBOE */
      try{ return await yahooQuoteCSV(q.y,sym,q.lo,q.hi); }              /* эшелон 1–2: Yahoo query1/query2 */
      catch(e){                                                          /* эшелон 3: легаси Stooq (вдруг оживёт) */
        const csv=await getTEXT("https://stooq.com/q/l/?s="+encodeURIComponent(sym)+"&f=sd2t2ohlcv&h&e=csv");
        const c=String(csv).trim().split(/\r?\n/).pop().split(",");
        if(c.length<7||!(+c[6]>q.lo&&+c[6]<q.hi)) throw new Error("Yahoo и Stooq недоступны/вне диапазона");
        return csv;
      }
    });
  }

  /* ── слияние с последним удачным снимком: сбой источника ≠ дырка на сайте ──
     v4.9: критерий здоровья fredOk считается ДО подкладок (раньше протухший ключ FRED
     вечно публиковал стареющие данные «успешно»); возраст подкладки меряется от ПЕРВОГО
     появления данных (цепочка stale_keys), а не от прошлого снимка, который всегда свеж:
     новости — максимум 3 суток, интрадей — 3 суток, остальные ряды — 7 суток. */
  const fredFresh=Object.keys(R).filter(k=>k.startsWith("fred:")).length;
  const stale_keys={};
  try{
    if(prevSnap){
      const prev=prevSnap;
      const failedKeys=failed.map(f=>String(f).split(" — ")[0]);
      /* v5.0: устаревшая подложка первоисточника не должна заслонять СВЕЖИЙ резерв того же ряда.
         Страница берёт первоисточник, если его ключ есть, и до резерва не доходит — поэтому при
         многодневном сбое NY Fed она видела SRF/RRP недельной давности, хотя свежий FRED-резерв лежал
         рядом в том же снимке. Если резерв этого прогона собран, первоисточник не подкладываем. */
      const FALLBACK={"nyfed:srf":["fred:RPONTTLD"],"nyfed:rrp":["fred:RRPONTSYD"],
        "cg:bitcoin":["bin:BTCUSDT","stqd:btcusd"],"cg:pax-gold":["bin:PAXGUSDT","stqd:xauusd"],
        "fx:JPY":["fred:DEXJPUS"],"fx:CNY":["fred:DEXCHUS"],"fred:SAHMREALTIME":["fred:UNRATE"]};
      for(const k of failedKeys){
        if((FALLBACK[k]||[]).some(f=>R[f]!==undefined)) continue;
        const origin=new Date((prev.stale_keys&&prev.stale_keys[k])||prev.generated_at).getTime();
        const age=Date.now()-origin;
        const cap=k.startsWith("ydiv:")?45*86400e3:
                  k.startsWith("ypx:")?3*86400e3:                                     /* v5.0: цены корзин — как интрадей, 3 сут. */                                  /* ydiv: история выплат меняется раз в квартал — держим до окна свежести (45 дн.) */
                  (k.startsWith("fh:")||k.startsWith("stq:"))?3*86400e3:7*86400e3;  /* stq: (интрадей) — 3 сут.; stqd: (дневная история, резерв крипто) — 7 сут. */
        if(age>cap) continue;                       /* слишком старое не подкладываем: пусть карточка честно скажет о сбое */
        if(prev.responses&&prev.responses[k]!==undefined&&R[k]===undefined){
          R[k]=prev.responses[k];
          stale_keys[k]=(prev.stale_keys&&prev.stale_keys[k])||prev.generated_at;
          const i=failed.findIndex(f=>String(f).startsWith(k+" "));
          if(i>=0) failed[i]+=" (подложено из снимка "+String(stale_keys[k]).slice(0,16)+")";
        }
      }
    }
  }catch(e){console.log("merge с прошлым снимком пропущен:",String(e&&e.message||e));}
  /* v4.9: слой fh:newsHit не проходит через put()/failed — наследуем его явно при сбое
     Finnhub (иначе один неудачный запуск стирал накопленное 14-дневное окно детекторов) */
  try{
    const cut=Date.now()/1000-14*86400;
    for(const s of NEWS_SYMBOLS){const k="fh:newsHit:"+s;
      if(R[k]===undefined&&prevSnap&&prevSnap.responses&&Array.isArray(prevSnap.responses[k]))
        R[k]=prevSnap.responses[k].filter(n=>(n.datetime||0)>cut);}
  }catch(e){}

  /* ── запись ── */
  mkdirSync(OUT.split("/").slice(0,-1).join("/")||".",{recursive:true});
  writeFileSync(OUT,JSON.stringify({generated_at:new Date().toISOString(),
    ok:Object.keys(R).length, failed, stale_keys,
    meta:{symbols:NEWS_SYMBOLS,
      llm:OPENROUTER_KEY?{model:OPENROUTER_MODEL,verdicts:(R["fh:newsVer"]||[]).length,judged_now:LLM_JUDGED}:null},
    responses:R}));
  console.log(`снимок: ${Object.keys(R).length} источников (fred свежих: ${fredFresh}), сбоев: ${failed.length}`);
  failed.forEach(f=>console.log("  ! "+f));
  if(fredFresh<18) { console.error("критично мало СВЕЖИХ серий FRED — помечаю запуск неудачным"); process.exit(1); }
}
main().catch(e=>{console.error("сборщик упал:",e);process.exit(1);});
