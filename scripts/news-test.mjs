#!/usr/bin/env node
/* ═══ Тест новостных детекторов (v5.0) ═══
   Исполняет ТОТ ЖЕ текст ядра сканера, что страница и сборщик: блок ⟦NEWS-CORE⟧…⟦/NEWS-CORE⟧
   из docs/index.html (new Function с CONFIG.CYCLE из картриджа страницы). Браузер не нужен.
   Проверяет:
     1) батарею размеченных заголовков (ФАКТ / неподтв. / не-факт) — печатает матрицу ошибок
        и требует ноль ошибок по «засчитанному факту» (класс fact И верная компания корзины);
     2) спор якоря с судьёй: отрицательный вердикт делает якорный заголовок «неподтверждённым»,
        положительный — фактом; subject судьи используется для атрибуции; старые записи кэша
        [h,"fact"|"opinion",t] читаются;
     3) атрибуцию и склейку перепечаток (Broadcom/Anthropic в лентах MSFT и AMZN — одно событие
        без компании; форс-мажор Oracle в двух лентах — одна компания; две компании — две);
     4) разбор ответа судьи (новый формат, повтор id, старый {"confirmed":[…]}, мусор);
     5) дивидендную data-ногу divLeg: глубокая срезка >40% (свежая и устойчивая), приостановка,
        защита спецов (OBDC-подобные доплаты, GBDC-спец за 10 дней до регулярной), stale-ряд;
     6) HIT_RX: копии страницы и сборщика побайтово совпадают и покрывают каждого кандидата —
        и батареи, и всех заголовков из docs/snapshot.json.
   Запуск: node scripts/news-test.mjs   (код выхода 1 при любой ошибке) */
import {readFileSync, existsSync} from "node:fs";

const page=readFileSync("docs/index.html","utf-8").replace(/\r\n/g,"\n");
const cyc=n=>JSON.parse(page.match(new RegExp(n+":\\s*(\\[[^\\]]*\\])"))[1]);
const CONFIG={CYCLE:{capexTickers:cyc("capexTickers"),bdcTickers:cyc("bdcTickers")}};
const blk=page.match(/\/\* ⟦NEWS-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/NEWS-CORE⟧ \*\//);
if(!blk){console.error("нет блока ⟦NEWS-CORE⟧ в docs/index.html");process.exit(1);}
const C=new Function("CONFIG",blk[1]+"\nreturn {newsMatch,newsClass,newsSubject,newsEvents,newsTally,newsDet,newsDriver,ruleDriver,JUDGE_DRIVERS,divEvent,judgePrompt,parseJudge,verEntry,divLeg,HIT_RX,VER_TTL,CO_TICKERS};")(CONFIG);

let fails=0;
const ok=(cond,msg)=>{if(!cond){fails++;console.log("  ✗ "+msg);}};

/* классификация одной записи так же, как applyVer на странице */
function judge(h,src,feeds,ver,kind){
  const m=C.newsMatch(h,feeds,src);
  const k=kind||(m.capex?"capex":m.bdc?"bdc":null);
  if(!k||!m[k]) return {cls:"none",sym:null,anchor:""};
  return {cls:C.newsClass(m[k],h,src,ver),sym:C.newsSubject(m[k],k,ver),anchor:m[k].anchor,kind:k};
}

/* ── 1) батарея: [заголовок, источник, лента, метка F|U|N, компания для F/U] ──
   F — реальное событие ставки у компании корзины: должно засчитываться как ФАКТ этой компании;
   U — событие, но без подтверждения (слух/отчёт/реакция рынка): не факт, неподтверждённый той же компании;
   N — не событие ставки (мнение, вопрос, макро, чужая компания, чужой объект): НЕ факт корзины. */
const B=[
 ["Microsoft cuts fiscal 2027 capex guidance","Reuters","MSFT","F","MSFT"],
 ["Oracle declares force majeure on Stargate data center","Reuters","ORCL","F","ORCL"],
 ["Meta takes $3 billion impairment on AI servers","Reuters","META","F","META"],
 ["FS KKR cuts quarterly distribution to $0.48 from $0.70","Reuters","FSK","F","FSK"],
 ["Blue Owl halts redemptions at private credit fund","Reuters","OBDC","F","OBDC"],
 ["Microsoft cuts capex guidance, reiterates spending plans","Reuters","MSFT","F","MSFT"],
 ["Meta lowers 2027 capex outlook; no change to data center leases","Yahoo","META","F","META"],
 ["Alphabet trims capital expenditure forecast for 2027","Yahoo","GOOGL","F","GOOGL"],
 ["Amazon pauses data center construction in Mississippi","Yahoo","AMZN","F","AMZN"],
 ["Microsoft delays Wisconsin data center project","Reuters","MSFT","F","MSFT"],
 ["CoreWeave postpones Texas AI campus","Yahoo","CRWV","F","CRWV"],
 ["Meta shortens useful life of servers to four years","Yahoo","META","F","META"],
 ["Golub Capital BDC suspends dividend","Yahoo","GBDC","F","GBDC"],
 ["MidCap Financial sets distribution at $0.25, down from $0.38","Yahoo","MFIC","F","MFIC"],
 ["Ares Capital reduces regular quarterly dividend to $0.40","Yahoo","ARCC","F","ARCC"],
 ["Blackstone Secured Lending limits withdrawals after redemption requests surge","Reuters","BXSL","F","BXSL"],
 ["Oracle Invokes Force Majeure on a Data Center It Says Is Still on Schedule","Yahoo","ORCL","F","ORCL"],
 ["Oracle sends 'force majeure' notice about data center project — stock sinks 4%","CNBC","ORCL","F","ORCL"],
 ["'Oracle Cites ‘Force Majeure’ to Shield Itself on Controversial Data Center' - Bloomberg","Benzinga","ORCL","F","ORCL"],
 ["Oracle invokes ‘force majeure’ on Project Jupiter, but says data center still on track","Yahoo","ORCL","F","ORCL"],
 ["Microsoft writes down $2 billion of data center assets","Reuters","MSFT","F","MSFT"],
 ["OBDC gates tender offer as requests pile up","Yahoo","OBDC","F","OBDC"],
 ["Google halts data center expansion in Arizona","Yahoo","GOOGL","F","GOOGL"],
 ["FS KKR Capital Corp. slashes distribution by 30%","Reuters","FSK","F","FSK"],
 ["CoreWeave files for Chapter 11 bankruptcy protection","Reuters","CRWV","F","CRWV"],
 ["Oracle declares force majeure on Stargate data center","Reuters","OBDC","F","ORCL"],          /* чужая лента — компания из заголовка */
 ["Microsoft delays Abilene data center by a month","Reuters","MSFT","F","MSFT"],
 ["Oracle declares force majeure, shares suffer worst day since 2002","Reuters","ORCL","F","ORCL"],
 ["Oracle Shares Fall 1.8% After Report Flags Potential Wisconsin AI Data Centre Delays","Yahoo","ORCL","U","ORCL"],
 ["Market Chatter: Oracle Cites Force Majeure as New Mexico Data Center Faces Delays","Yahoo","ORCL","U","ORCL"],
 ["Bloom Energy CEO Shrugs Off Oracle Force Majeure Worries, Says Bloom Boxes Are 'Fungible'","Yahoo","ORCL","U","ORCL"],
 ["Oracle Stock Falls on Force Majeure Notice for Data Center","Yahoo","ORCL","U","ORCL"],
 ["Meta's Louisiana data center project shelved","Reuters","META","U","META"],          /* пассив — событие, но без якоря */
 ["Blue Owl fund redemptions halted as requests mount","Reuters","OBDC","U","OBDC"],
 ["Oracle shares slip on unconfirmed report of delays at Wisconsin AI mega-campus","Yahoo","ORCL","U","ORCL"],
 ["Oracle's New Mexico data center unlikely to be canceled, says D.A. Davidson's Gil Luria","Yahoo","ORCL","N"],
 ["National retailer files Chapter 11 after 80 stores closed in 2026","Yahoo","AMZN","N"],
 ["Oracle battles to delay payments on $165bn data centre","Yahoo","ORCL","N"],
 ["Ares Capital cuts distribution reinvestment plan fees","Reuters","ARCC","N"],
 ["Microsoft-backed OpenAI delays Abilene data center","Reuters","MSFT","N"],
 ["Microsoft's capex cut is a gift for Nvidia bears","Yahoo","MSFT","N"],
 ["How Much Does a 65-Year-Old Need Invested to Collect $6,250 a Month From Ares Capital Dividends Without a Cut?","Yahoo","ARCC","N"],
 ["3 Dividend Stocks to Buy Before FS KKR Cuts Its Payout","Yahoo","FSK","N"],
 ["Will Meta take an impairment on Reality Labs?","Yahoo","META","N"],
 ["Why investors should write down Meta's metaverse dreams","Yahoo","META","N"],
 ["Is Meta headed for a massive write-down?","Yahoo","META","N"],
 ["Meta's $5 Billion Write-Down Is a Warning for Investors","Yahoo","META","N"],
 ["Amazon takes $2.3 billion write-down on Rivian stake","Reuters","AMZN","N"],
 ["Microsoft cuts 6,000 jobs even as it lifts capex forecast","Reuters","MSFT","N"],
 ["Fed slashes rates; BDC dividends at risk","Reuters","ARCC","N"],
 ["Fed cuts rates again; BDC payouts in focus","Reuters","FSK","N"],
 ["Should you buy Oracle stock after its force majeure notice?","Yahoo","ORCL","N"],
 ["3 Reasons Microsoft Could Cut Capex in 2027","Yahoo","MSFT","N"],
 ["Is it time to sell Ares Capital before a dividend cut?","Yahoo","ARCC","N"],
 ["Analysts warn Meta may cut AI infrastructure spending","Yahoo","META","N"],
 ["RBC lowers FSK price target, payout risk grows","Benzinga","FSK","N"],
 ["Microsoft won't cut capex, CFO says","Reuters","MSFT","N"],
 ["Meta denies report it will slash AI infrastructure spending","Reuters","META","N"],
 ["Intel cuts capex forecast again","Reuters","MSFT","N"],
 ["Here's How Oracle's \"Force Majeure\" Changes the AI Data Center Thesis","Yahoo","ORCL","N"],
 ["How to Play Bloom Energy Stock Amid Oracle Data Center Force Majeure Rumors","Yahoo","ORCL","N"],
 ["Why I Won't Risk My Dividends On ARCC And BXSL","SeekingAlpha","ARCC","N"],
 ["Microsoft extends useful life of servers to six years","Yahoo","MSFT","N"],
 ["Ares Capital Announces Redemption Of 3.25% Notes Due 2026","Yahoo","ARCC","N"],
 ["ARES CAPITAL CORPORATION DECLARES 130TH CONSECUTIVE QUARTERLY DIVIDEND","Yahoo","ARCC","N"],
 ["Microsoft Q3: capex up 40%, no cuts to data center plans","Reuters","MSFT","N"],
 ["Amazon cuts prices on AWS GPU instances","Yahoo","AMZN","N"],
 ["Wells Fargo Downgrades FS KKR Capital to Underweight, Maintains Price Target to $10","Benzinga","FSK","N"],
 ["Blue Owl Stock Yields About 9% After Falling 45% From Its High. Is the Dividend Safe?","Yahoo","OBDC","N"],
 ["Oracle Wants Protection If Its AI Data Center Is Delayed. Here's What That Changes for Investors.","Yahoo","ORCL","N"],
 ["Fed's rate cut squeezes BDC dividend coverage","Reuters","ARCC","N"],
 ["Data center REIT cuts dividend amid rate pressure","Reuters","ARCC","N"],
 ["Broadcom to lend Anthropic up to $42 billion to lease chips, in latest circular investing deal","Yahoo","MSFT","N"],
 ["Meta Platforms reiterates capex guidance","Reuters","META","N"],
 ["Blue Owl Capital (OWL) Stock Looks Above Fair Value Following A 43% Fall","Yahoo","OBDC","N"],
 ["Microsoft supplier Intel cuts capex","Reuters","MSFT","N"]
];
console.log("1) батарея: "+B.length+" размеченных заголовков");
const tab={F:{},U:{},N:{}};
let cErr=0;
for(const [h,src,feed,lab,sym] of B){
  const r=judge(h,src,[feed]);
  const counted=r.cls==="fact"&&!!r.sym;               /* засчитывается детектором как факт компании */
  const col=r.cls==="fact"?(r.sym?"fact":"fact·вне корзины"):r.cls;
  tab[lab][col]=(tab[lab][col]||0)+1;
  let bad=false;
  if(lab==="F") bad=!(counted&&r.sym===sym);
  if(lab==="U") bad=!(r.cls==="unverified"&&r.sym===sym);
  if(lab==="N") bad=counted;
  if(bad){cErr++;ok(false,"["+lab+"] ждали "+(lab==="N"?"не-факт":(lab==="F"?"факт ":"неподтв. ")+sym)+", получили "+r.cls+(r.sym?" "+r.sym:"")+(r.anchor?" ·якорь "+r.anchor:"")+" | "+h);}
}
const cols=["fact","fact·вне корзины","unverified","opinion","none"];
console.log("   матрица (строки — метка, столбцы — класс сканера без LLM):");
console.log("   "+"метка".padEnd(8)+cols.map(c=>c.padStart(17)).join(""));
for(const l of ["F","U","N"]) console.log("   "+l.padEnd(8)+cols.map(c=>String(tab[l][c]||0).padStart(17)).join(""));
console.log("   ошибок по «засчитанному факту»: "+cErr);

/* ── 2) судья против якоря ── */
console.log("2) вердикты судьи");
{
  const h="Oracle declares force majeure on Stargate data center";
  ok(judge(h,"Reuters",["ORCL"],{cls:"opinion",subject:"none",type:"other"}).cls==="unverified","якорь + отказ судьи → неподтверждённый (не факт)");
  ok(judge(h,"Reuters",["ORCL"],{cls:"fact",subject:"ORCL",type:"dc_delay"}).cls==="fact","якорь + подтверждение → факт");
  ok(judge(h,"Reuters",["ORCL"],null).cls==="fact","якорь без вердикта → факт");
  const q="Will Meta take an impairment on AI servers?";
  ok(judge(q,"Yahoo",["META"],null).cls==="opinion","вопрос с ИИ-контекстом без вердикта → мнение");
  ok(judge(q,"Yahoo",["META"],{cls:"opinion"}).cls==="opinion","вопрос + отказ → мнение");
  const i="Intel cuts capex forecast again";
  ok(judge(i,"Reuters",["MSFT"],{cls:"fact",subject:"none",type:"capex_cut"}).sym===null,"subject=none от судьи → вне корзины");
  const s="Report: hyperscaler slashes data center spending plans";
  ok(judge(s,"Reuters",["MSFT"],{cls:"fact",subject:"MSFT",type:"capex_cut"}).sym==="MSFT","subject судьи используется для атрибуции");
  ok(judge(s,"Reuters",["MSFT"],{cls:"fact",subject:"OBDC",type:"capex_cut"},"capex").sym===null,"subject из чужой корзины не засчитывается");
  const old=C.verEntry(["Microsoft cuts fiscal 2027 capex guidance","opinion",1790000000]);
  ok(old&&old.cls==="opinion"&&old.subject===null,"старая запись кэша читается");
  ok(judge("Microsoft cuts fiscal 2027 capex guidance","Reuters",["MSFT"],old).cls==="unverified","старый отрицательный вердикт против якоря → неподтверждённый");
  const nw=C.verEntry(["x","fact",1790000000,"orcl","dc_delay"]);
  ok(nw&&nw.subject==="ORCL"&&nw.type==="dc_delay","новая запись кэша читается");
  ok(C.VER_TTL.neg===3*86400&&C.VER_TTL.fact===14*86400,"TTL кэша: отказ 3 сут., факт 14 сут.");
}

/* ── 3) атрибуция и склейка перепечаток ── */
console.log("3) события и компании");
{
  const T0=1790856977;
  const mk=(h,feed,t,src="Yahoo")=>{const m=C.newsMatch(h,[feed],src),k=m.capex?"capex":"bdc",x=m[k];
    return x?{h,feed,t,src,cls:C.newsClass(x,h,src,null),sym:C.newsSubject(x,k,null),driver:C.newsDriver(x,h,null)}:null;};
  /* Broadcom/Anthropic: не кандидат вовсе; склейка — на синтетических записях одного класса */
  const ev0=C.newsEvents([
    {h:"Broadcom to lend Anthropic up to $42 billion to lease chips, in latest circular investing deal",t:T0,cls:"fact",sym:null,feed:"MSFT"},
    {h:"Broadcom to lend Anthropic up to $42 billion in deal to lease chips",t:T0,cls:"fact",sym:null,feed:"AMZN"}]);
  ok(ev0.length===1&&ev0[0].dup===2,"две редакции Broadcom/Anthropic → одно событие (×2)");
  ok(C.newsTally([...ev0]).fSyms.length===0,"событие без компании корзины не даёт ни одной компании");
  const a=[mk("Oracle declares force majeure on Stargate data center","ORCL",T0),
           mk("Oracle declares force majeure on Stargate data center project","MSFT",T0+3600),
           mk("Intel cuts capex forecast again","MSFT",T0,"Reuters"),
           mk("Intel cuts capex forecast again","AMZN",T0+10,"Reuters")].filter(Boolean);
  const t1=C.newsTally(a);
  ok(t1.fric.syms.join()==="ORCL"&&t1.fric.n===1&&t1.fN===0,"форс-мажор Oracle в двух лентах → одна компания, одно событие, трение (fric="+JSON.stringify(t1.fric)+", fN="+t1.fN+")");
  ok(t1.uSyms.length===0&&t1.out>=1,"«Intel cuts capex» в лентах MSFT/AMZN → вне корзины, не тикер");
  const b=[...a,mk("Microsoft cuts fiscal 2027 capex guidance","MSFT",T0+7200,"Reuters")];
  ok(C.newsTally(b).fSyms.join()==="MSFT","Oracle (трение) + Microsoft (срезка) → одна компания-отступление");
  const b2=[...b,mk("Meta cuts 2027 capex guidance","META",T0+9000,"Reuters")];
  ok(C.newsTally(b2).fSyms.length===2&&C.newsDet(C.newsTally(b2),"capex").st==="fired","Microsoft + Meta (срезки) → две компании (СРАБОТАЛ)");
  const c=C.newsEvents([{h:"Microsoft cuts capex guidance",t:T0,cls:"fact",sym:"MSFT"},{h:"Meta cuts capex guidance",t:T0,cls:"fact",sym:"META"}]);
  ok(c.length===2,"разные компании в одну секунду не склеиваются");
  const via=judge("Microsoft supplier Intel cuts capex","Reuters",["MSFT"],null);
  ok(via.sym===null,"«Microsoft supplier Intel cuts capex» → не Microsoft (посредник)");
  ok(judge("Microsoft says it will cut capex","Reuters",["AMZN"],null).sym==="MSFT","«Microsoft says it will cut capex» → MSFT (не якорь, но подлежащее)");
  ok(judge("Microsoft-backed OpenAI delays Abilene data center","Reuters",["MSFT"],null).sym===null,"«Microsoft-backed OpenAI delays…» → вне корзины");
  const d=C.newsEvents([{h:"Microsoft cuts capex guidance by $5 billion",t:T0,cls:"fact",sym:"MSFT"},{h:"Microsoft cuts capex guidance by $5 billion",t:T0+80*3600,cls:"fact",sym:"MSFT"}]);
  ok(d.length===2,"та же формулировка через 80 ч — уже другое событие");
}

/* ── 4) разбор ответа судьи ── */
console.log("4) разбор ответа судьи");
{
  const ids=["C0","C1","B2"];
  const p=C.parseJudge('думаю… пример {"id":"C0","cls":"opinion","subject":"none","type":"other"} итог: {"verdicts":[{"id":"C0","cls":"fact","subject":"ORCL","type":"dc_delay"},{"id":"C1","cls":"unverified","subject":"msft","type":"capex_cut"},{"id":"B2","cls":"bogus"},{"id":"C9","cls":"fact"}]}',ids);
  ok(p.get("C0")&&p.get("C0").cls==="fact"&&p.get("C0").subject==="ORCL","повтор id — берётся последний");
  ok(p.get("C1")&&p.get("C1").subject==="MSFT","subject нормализуется к тикеру");
  ok(!p.has("B2")&&!p.has("C9"),"битый cls и чужой id отбрасываются");
  const q=C.parseJudge('{"confirmed":["B2"]}',ids);
  ok(q.get("B2").cls==="fact"&&q.get("C0").cls==="opinion","старый формат {confirmed} читается");
  ok(C.parseJudge("нет json",ids).size===0,"мусор → пусто");
  const pr=C.judgePrompt([["C0","x"]]);
  ok(/subject/.test(pr)&&/ORCL \(Oracle\)/.test(pr)&&/ИИ-, серверных или дата-центровых/.test(pr),"промпт несёт корзины, subject и ограничение impairment");
}

/* ── 5) дивидендная data-нога ── */
console.log("5) дивидендная нога divLeg");
{
  const D=86400, Q=91*D, now=1791000000;
  const ser=(amts,lastT,step=Q)=>amts.map((a,i)=>[lastT-(amts.length-1-i)*step,a]);
  let r=C.divLeg(ser([0.7,0.7,0.7,0.7,0.7,0.35],now-20*D),now,false);
  ok(r&&r.fresh&&r.lastA===0.35,"срезка −50% последней выплатой сетки (20 дн. назад) → свежая срезка");
  r=C.divLeg(ser([0.7,0.7,0.7,0.7,0.7,0.35],now-5*D),now,false);
  ok(!r||!r.fresh,"та же срезка 5 дней назад — ждём регулярную вдогонку (спец-защита)");
  r=C.divLeg(ser([0.7,0.7,0.7,0.7,0.7,0.35,0.35,0.35],now-20*D),now,false);
  ok(r&&!r.fresh&&r.staleCut&&r.lastA===0.35,"новый уровень держится — тикер не выпадает, срезка давняя");
  r=C.divLeg(ser([0.7,0.7,0.7,0.7,0.7,0.7],now-170*D),now,false);
  ok(r&&r.susp&&r.susp.fresh,"нет выплаты 170 дн. при шаге 91 → приостановка");
  r=C.divLeg(ser([0.7,0.7,0.7,0.7,0.7,0.7],now-170*D),now,true);
  ok(r&&!r.susp,"подложенный (stale) ряд приостановкой не считается");
  r=C.divLeg(ser([0.7,0.7,0.7,0.7,0.7,0.7],now-120*D),now,false);
  ok(r&&!r.susp,"120 дн. при шаге 91 — ещё не приостановка");
  /* OBDC-подобный ряд: доплаты 0,01–0,02 за месяц до регулярной */
  const obdc=[[1743427800,0.37],[1748611800,0.01],[1751290200,0.37],[1756474200,0.02],[1759239000,0.37],[1767191400,0.37],[1774963800,0.37],[1782826200,0.31],[1788183000,0.02]];
  r=C.divLeg(obdc,1788183000+20*D,false);
  ok(r&&!r.fresh&&r.lastA===0.31,"OBDC: доплата 0,02 последней записью — не срезка");
  /* GBDC-подобный: спец 23% регулярной за 10 дней до неё */
  const g=[...ser([0.39,0.39,0.39,0.39,0.39],now-100*D),[now-100*D+81*D,0.09]];
  r=C.divLeg(g,now-100*D+81*D+20*D,false);
  ok(r&&!r.fresh,"GBDC: спец 0,09 перед регулярной — не срезка");
  const g2=[...ser([0.39,0.39,0.39,0.39,0.39],now-200*D),[now-200*D+81*D,0.18],[now-200*D+91*D,0.39],[now-200*D+172*D,0.18],[now-200*D+182*D,0.39]];
  r=C.divLeg(g2,now,false);
  ok(r&&!r.fresh&&!r.staleCut,"повторяющиеся спецы 46% за 10 дней до регулярной — не «новый уровень»");
  const snapP="docs/snapshot.json";
  if(existsSync(snapP)){const S=JSON.parse(readFileSync(snapP,"utf-8"));const R=S.responses||{},nowS=Date.parse(S.generated_at)/1000;
    for(const s of CONFIG.CYCLE.bdcTickers){const x=C.divLeg(R["ydiv:"+s],nowS,false);
      console.log("   снимок "+s+": "+(!x?"нет оценки":x.fresh?"СВЕЖАЯ СРЕЗКА":x.susp?"пропуск":x.staleCut?"давняя срезка":"ровно")+(x?" (посл. "+x.lastA+", пред. "+x.prev+")":""));}}
}

/* ── 6) HIT_RX: копии совпадают и покрывают кандидатов ── */
console.log("6) HIT_RX ⊇ словари кандидатов");
{
  const srv=readFileSync("scripts/fetch-snapshot.mjs","utf-8").match(/\nconst HIT_RX=(\/[^\n]+\/i);/);
  ok(srv&&srv[1]===C.HIT_RX.toString(),"HIT_RX сборщика побайтово равен странице");
  const heads=new Set(B.map(x=>x[0]));
  if(existsSync("docs/snapshot.json")){const R=JSON.parse(readFileSync("docs/snapshot.json","utf-8")).responses||{};
    for(const k in R) if(k.startsWith("fh:news")&&Array.isArray(R[k])) R[k].forEach(n=>n&&n.headline&&heads.add(n.headline));}
  let cand=0,miss=[];
  for(const h of heads){const m=C.newsMatch(h,[...C.CO_TICKERS.capex,...C.CO_TICKERS.bdc],"Reuters");
    if(m.capex||m.bdc||m.soft){cand++;if(!C.HIT_RX.test(h))miss.push(h);}}
  ok(!miss.length,"кандидаты вне HIT_RX: "+miss.slice(0,5).join(" | "));
  console.log("   заголовков проверено: "+heads.size+", кандидатов: "+cand);
}

/* ── 7) v5.4: причина события; пороги — только по отступлениям ── */
console.log("7) причина события и счёт по отступлениям (v5.4)");
{
  const J=JSON.parse(readFileSync("scripts/fixtures/news-2026-10.json","utf-8"));
  const one=x=>{const m=C.newsMatch(x.h,x.feeds,x.src),k=m.capex?"capex":"bdc",mm=m[k],v=x.ver?C.verEntry(x.ver):null;
    return {k,h:x.h,t:x.t,src:x.src,cls:C.newsClass(mm,x.h,x.src,v),sym:C.newsSubject(mm,k,v),driver:C.newsDriver(mm,x.h,v)};};
  const all=J.items.map(one), capex=all.filter(x=>x.k==="capex");
  const by=pre=>all.find(x=>x.h.startsWith(pre))||{};
  /* реальные заголовки октября: ни один факт стройки не отступление */
  const hard=capex.filter(x=>(x.cls==="fact"||x.cls==="unverified")&&x.sym);
  ok(hard.length>=25,"фактов и неподтверждённых стройки в фикстуре: "+hard.length);
  ok(!hard.some(x=>x.driver==="retreat"),"факты стройки октября — не отступление: "+hard.filter(x=>x.driver==="retreat").map(x=>x.h).join(" | "));
  for(const pre of ["Oracle Invokes Force Majeure on a Data Center It Says Is Still on Schedule","Oracle invokes ‘force majeure’ on Project Jupiter, but says",
    "Google's $15 Billion Finland AI Push Hits Roadblock as Regulators","Finnish Authorities Order Google to Halt","Google ordered to halt work on two data centers",
    "Oracle trucks natural gas to data centers","Microsoft drops Nscale’s Loughton AI data center over interconnection delay",
    "Amazon Just Walked Away From a $427 Million Data Center Plan After Neighbors"])
    ok(by(pre).driver==="friction","трение: "+pre+" → "+by(pre).driver);
  ok(by("Microsoft Scraps UK Data Center Deal With Nscale").driver==="unclear","одна площадка без причины → без причины");
  /* окно 28.10 (14 дней): капекс спокоен, трения MSFT и AMZN, кластер Amazon целиком — трение */
  const win=capex.filter(x=>x.t>Date.UTC(2026,9,14)/1000), T=C.newsTally(win), D=C.newsDet(T,"capex");
  ok(D.st==="calm"&&D.pts===0,"октябрьский набор → капекс СПОКОЙНО, 0 (st="+D.st+", pts="+D.pts+")");
  ok(T.fric.syms.join()==="AMZN,MSFT","трения стройки у AMZN и MSFT: "+T.fric.syms);
  const amz=T.ev.filter(e=>e.sym==="AMZN"&&e.cls!=="opinion");
  ok(amz.length===1&&amz[0].dup===3&&amz[0].driver==="friction","кластер Amazon ($427 млн, три пересказа) — одно событие, трение ("+amz.map(e=>e.dup+"/"+e.driver)+")");
  /* окно 7.10 (форс-мажор Oracle + остановка Google): прежнее правило — СРАБОТАЛ, новое — СПОКОЙНО */
  const w7=capex.filter(x=>x.t>Date.UTC(2026,8,23)/1000&&x.t<Date.UTC(2026,9,8,12)/1000), T7=C.newsTally(w7);
  ok(T7.fric.syms.includes("ORCL")&&T7.fric.syms.includes("GOOGL")&&C.newsDet(T7,"capex").st==="calm","7.10: Oracle и Google — трения, капекс СПОКОЙНО");
  /* синтетические отступления */
  const syn=(h,feed,src="Reuters",ver=null)=>one({h,feeds:[feed],src,t:1793000000,ver});
  const meta=syn("Meta lowers 2027 capital expenditure outlook as AI returns disappoint","META");
  ok(meta.cls==="fact"&&meta.sym==="META"&&meta.driver==="retreat","Meta снижает прогноз капекса → факт-отступление ("+meta.cls+"/"+meta.driver+")");
  const lease=syn("Microsoft cancels leases totaling 2 GW, TD Cowen says","MSFT");
  ok(lease.cls==="unverified"&&lease.sym==="MSFT"&&lease.driver==="retreat","отмена аренды на 2 ГВт по отчёту → неподтв. отступление ("+lease.cls+"/"+lease.driver+")");
  ok(C.HIT_RX.test("Microsoft cancels leases totaling 2 GW, TD Cowen says"),"префильтр пропускает отмену аренды на 2 ГВт");
  ok(!C.newsMatch("Meta exits office leases amid AI push",["META"],"Reuters").capex,"аренда офисов — не кандидат");
  const goog=syn("Alphabet cuts 2027 capex guidance as cloud demand cools","GOOGL");
  const ev2=x=>({...x,cls:x.cls});
  ok(C.newsDet(C.newsTally([ev2(meta),ev2(goog)]),"capex").pts===-15,"два факта-отступления у разных компаний → −15");
  ok(C.newsDet(C.newsTally([ev2(meta)]),"capex").pts===-5,"один факт-отступление → −5");
  ok(C.newsDet(C.newsTally([ev2(lease),{...ev2(lease),h:"Meta pulls back on data center leases, sources say",sym:"META",cls:"unverified",driver:"retreat"}]),"capex").st==="watch","неподтверждённые отступления у двух компаний → НАБЛЮДЕНИЕ");
  ok(C.newsDet(C.newsTally([{...ev2(meta),driver:"friction"},{...ev2(goog),driver:"unclear"}]),"capex").pts===0,"трение и «без причины» → 0");
  /* BDC: гейт — отступление, срезка — «срезка выплат», приостановка — отступление */
  const gate=syn("Blue Owl halts redemptions at private credit fund","OBDC"), cut=syn("FS KKR cuts quarterly distribution to $0.48 from $0.70","FSK"),
        cut2=syn("Ares Capital reduces regular quarterly dividend to $0.40","ARCC"), susp=syn("Golub Capital BDC suspends dividend","GBDC");
  ok(gate.driver==="retreat"&&cut.driver==="reset"&&cut2.driver==="reset"&&susp.driver==="retreat","BDC: гейт/срезка/приостановка → "+[gate.driver,cut.driver,cut2.driver,susp.driver]);
  const TB=C.newsTally([cut,cut2]);
  ok(C.newsDet(TB,"bdc").pts===0&&TB.reset.syms.length===2,"две срезки выплат → BDC 0, видны как срезки");
  ok(C.newsDet(C.newsTally([gate,susp]),"bdc").pts===-15,"гейт + приостановка у разных BDC → −15");
  ok(C.newsDet(C.newsTally([cut]),"bdc",["MFIC"]).pts===-4,"приостановка по данным выплат — факт-отступление (−4 при одной)");
  ok(C.divEvent({fresh:true})==="reset"&&C.divEvent({fresh:false,susp:{fresh:true}})==="retreat"&&C.divEvent({fresh:false,susp:{fresh:false}})===null&&C.divEvent(null)===null,"divEvent: срезка → reset, приостановка → retreat");
  /* судья: driver в ответе и без него; записи кэша на 3, 5 и 6 элементах */
  const ids=["C0","C1","B2"];
  const p=C.parseJudge('{"verdicts":[{"id":"C0","cls":"fact","subject":"MSFT","type":"dc_delay","driver":"friction"},{"id":"C1","cls":"fact","subject":"META","type":"capex_cut","driver":"RETREAT"},{"id":"B2","cls":"fact","subject":"FSK","type":"dividend_cut","driver":"bogus"}]}',ids);
  ok(p.get("C0").driver==="friction"&&p.get("C1").driver==="retreat"&&p.get("B2").driver===null,"parseJudge: driver нормализуется, мусор → null");
  ok(C.parseJudge('{"verdicts":[{"id":"C0","cls":"fact","subject":"MSFT","type":"dc_delay"}]}',ids).get("C0").driver===null,"parseJudge без driver → null (причина по правилам)");
  const e3=C.verEntry(["h","fact",1]),e5=C.verEntry(["h","fact",1,"MSFT","dc_delay"]),e6=C.verEntry(["h","fact",1,"MSFT","dc_delay","friction"]),e6b=C.verEntry(["h","fact",1,"MSFT","dc_delay",""]);
  ok(e3&&e5&&e6&&e6b&&e3.driver===null&&e5.driver===null&&e6.driver==="friction"&&e6b.driver===null&&e5.subject==="MSFT","verEntry на 3, 5 и 6 элементах");
  const mN=C.newsMatch("Microsoft drops Nscale’s Loughton AI data center over interconnection delay",["MSFT"],"Reuters").capex;
  ok(C.newsDriver(mN,"Microsoft drops Nscale’s Loughton AI data center over interconnection delay",{cls:"fact",driver:"retreat"})==="friction","явное трение в заголовке сильнее «retreat» судьи");
  const mA=C.newsMatch("Amazon.com (AMZN) Cancels $427 Million Loudoun County Data Center Project",["AMZN"],"Reuters").capex;
  ok(C.newsDriver(mA,"x",{cls:"fact",driver:"retreat"})==="retreat"&&C.newsDriver(mA,"Amazon.com (AMZN) Cancels $427 Million Loudoun County Data Center Project",{cls:"fact",driver:"friction"})==="friction","без слов трения решает судья");
  const pr=C.judgePrompt([["C0","x"]]);
  ok(/"driver"/.test(pr)&&/"retreat"/.test(pr)&&/"friction"/.test(pr)&&/"reset"/.test(pr)&&/"unclear"/.test(pr),"промпт несёт поле driver и четыре причины");
  /* правила A5 без вердикта */
  const R=C.ruleDriver;
  const rules=[["Microsoft trims capex guidance","capex_cut","retreat"],["Meta records impairment on AI servers","impairment","retreat"],["Blue Owl caps withdrawals","redemption_gate","retreat"],
    ["FS KKR cuts distribution","dividend_cut","reset"],["Golub suspends distribution","dividend_cut","retreat"],["MidCap eliminates dividend","dividend_cut","retreat"],
    ["Microsoft pauses Wisconsin data center amid permitting delays","dc_delay","friction"],["Meta delays data center as AI demand cools","dc_delay","retreat"],
    ["Amazon cancels data center project","dc_delay","unclear"],["Microsoft cancels $10 billion data center project","dc_delay","retreat"],
    ["Meta cancels data center leases","dc_delay","retreat"],["Oracle delays data center, says still on track","dc_delay","friction"],
    ["Oracle declares force majeure on Texas data center","dc_delay","friction"],["CoreWeave files for Chapter 11 bankruptcy","other","retreat"],
    ["Alphabet halts data center after residents protest","dc_delay","friction"],["Microsoft scales back data center build-out","dc_delay","retreat"]];
  for(const [h,t,want] of rules) ok(R(h,t)===want,"правило: «"+h+"» ("+t+") → "+R(h,t)+", ждали "+want);
  ok(C.JUDGE_DRIVERS.join()==="retreat,friction,reset,unclear","четыре причины");
  /* сборщик: факт кэша без driver переспрашивается один раз */
  const srv=readFileSync("scripts/fetch-snapshot.mjs","utf-8"), nd=srv.match(/const noDriver=(e=>[^;\n]+);/);
  ok(nd,"в сборщике есть noDriver");
  if(nd){const noDriver=new Function("return "+nd[1])();
    ok(noDriver(["h","fact",1,"MSFT","dc_delay"])&&noDriver(["h","fact",1])&&!noDriver(["h","fact",1,"MSFT","dc_delay",""])&&!noDriver(["h","opinion",1,"MSFT","dc_delay"]),"переспрос: факты без 6-го элемента — да, с ним и не-факты — нет");}
  ok(/v\.driver\|\|""\]/.test(srv),"сборщик пишет шестой элемент driver");
}

console.log(fails?("ПРОВАЛ: "+fails+" ошибок"):"OK: все проверки пройдены");
process.exit(fails?1:0);
