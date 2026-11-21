// Тест внутридневной термструктуры VIX (v5.6.1, v5.6.2). Без сети и без браузера.
//
// Проверяется ОРИГИНАЛ: ядро ⟦VIXTERM-CORE⟧ (termLive) исполняется прямо из docs/index.html, форма ключа
// stq:^vix3m — настоящей функцией valid() сборщика. Правило: числитель и знаменатель отношения — одной даты.
// До v5.6.1 вечером шокового дня сегодняшний VIX делился на вчерашнее закрытие VIX3M (19.11.2026: 1,17 при
// настоящих 1,05) и карточка уходила в зону «событие» при норме или паритете.
// v5.6.2: утром (VIX уже во внебиржевых часах новой даты, у VIX3M их нет) отношение берётся из пары котировок одной
// даты, которую сборщик хранит ключом cboe:vixpair (настоящая функция vixPair() сборщика); без неё 20.11.2026 с 08:46 до
// 14:46 UTC карточка откатывалась с 1,05 (19.11) к 1,01 (18.11).
// Запуск: node scripts/vixterm-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let failures = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("ok  ", name); }
  catch (e) { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); }
};

const page = readFileSync("docs/index.html", "utf-8").replace(/\r\n/g, "\n");
const collector = readFileSync("scripts/fetch-snapshot.mjs", "utf-8").replace(/\r\n/g, "\n");
const { termLive } = (() => {
  const m = page.match(/\/\* ⟦VIXTERM-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/VIXTERM-CORE⟧ \*\//);
  if (!m) throw new Error("в docs/index.html нет блока ⟦VIXTERM-CORE⟧");
  return new Function(m[1] + "\nreturn {termLive};")();
})();
const valid = (() => {
  const m = collector.match(/\nfunction valid\(key,j\)\{[\s\S]*?\n\}\n/);
  if (!m) throw new Error("в сборщике нет function valid(key,j)");
  return new Function(m[0] + "\nreturn valid;")();
})();
const vixPair = (() => {
  const m = collector.match(/\nfunction vixPair\(vixCsv,vix3mCsv,prev,nowMs\)\{[\s\S]*?\n\}\n/);
  if (!m) throw new Error("в сборщике нет function vixPair(vixCsv,vix3mCsv,prev,nowMs)");
  return new Function(m[0] + "\nreturn vixPair;")();
})();
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 18.11.2026: закрытия VIX 24,56 и VIX3M 24,29 (отношение 1,0111); 19.11: 28,44 и 27,03
const row18 = { day: "2026-11-18", v: 24.56 / 24.29 }, v3c18 = { day: "2026-11-18", v: 24.29 };
const vq19 = { day: "2026-11-19", v: 28.44 }, v3q19 = { day: "2026-11-19", v: 27.03 };

test("вечер шокового дня: знаменатель — VIX3M той же даты, а не вчерашнее закрытие", () => {
  const r = termLive(row18, v3c18, vq19, v3q19);
  assert.ok(r && near(r.v, 28.44 / 27.03) && r.den === 27.03 && r.same === false);
  assert.ok(r.v < 1.06, "прежний расчёт давал 28,44 / 24,29 = 1,17");
});

test("котировки VIX3M той же даты нет — подмеса нет (вчерашнее закрытие в знаменатель не идёт)", () => {
  assert.equal(termLive(row18, v3c18, vq19, null), null);
  assert.equal(termLive(row18, v3c18, vq19, { day: "2026-11-18", v: 24.29 }), null, "котировка VIX3M прошлой сессии");
  assert.equal(termLive(row18, v3c18, vq19, { day: "2026-11-19", v: 0 }), null, "мусорная котировка VIX3M");
  assert.equal(termLive(row18, v3c18, vq19, { day: "2026-11-19", v: 400 }), null, "VIX3M вне диапазона");
});

test("официальное закрытие VIX3M той же даты годится в знаменатель, когда котировки нет", () => {
  const row19 = { day: "2026-11-19", v: 28.44 / 27.03 }, v3c19 = { day: "2026-11-19", v: 27.03 };
  const r = termLive(row19, v3c19, { day: "2026-11-19", v: 29.5 }, null);
  assert.ok(r && near(r.v, 29.5 / 27.03) && r.same === true);
});

test("подмес только вверх: отношение не выше последней точки ряда — точка остаётся", () => {
  assert.equal(termLive(row18, v3c18, { day: "2026-11-19", v: 23 }, { day: "2026-11-19", v: 24.5 }), null);
  assert.equal(termLive(row18, v3c18, { day: "2026-11-19", v: 24.56 }, { day: "2026-11-19", v: 24.29 }), null, "равное — не выше");
});

test("протухшая или мусорная котировка VIX не подмешивается", () => {
  assert.equal(termLive(row18, v3c18, { day: "2026-11-17", v: 40 }, { day: "2026-11-17", v: 25 }), null, "дата старше ряда");
  assert.equal(termLive(row18, v3c18, { day: "2026-11-19", v: 3 }, v3q19), null);
  assert.equal(termLive(row18, v3c18, { day: "2026-11-19", v: 200 }, v3q19), null);
  assert.equal(termLive(row18, v3c18, null, v3q19), null);
  assert.equal(termLive(null, v3c18, vq19, v3q19), null);
});

test("тот же день, что у ряда: точка заменяется (same), знаменатель — котировка VIX3M той же даты", () => {
  const r = termLive(row18, v3c18, { day: "2026-11-18", v: 26 }, { day: "2026-11-18", v: 24.6 });
  assert.ok(r && r.same === true && near(r.v, 26 / 24.6) && r.den === 24.6);
});

// v5.6.2 — утреннее окно. Боевые снимки 20.11.2026: с 08:46 UTC VIX у CBOE датирован 20.11 (внебиржевые часы), VIX3M —
// 19.11, во FRED закрытия только по 18.11 (19.11 пришло в 14:46). Пара сборщика — закрытия 19.11.
const vqGth20 = { day: "2026-11-20", v: 29.76 }, pair19 = { day: "2026-11-19", vix: 28.44, vix3m: 27.03 };

test("v5.6.2: утреннее окно 20.11 — пара закрытий 19.11 даёт 1,05, точка датой пары", () => {
  const r = termLive(row18, v3c18, vqGth20, v3q19, pair19);
  assert.ok(r && near(r.v, 28.44 / 27.03), `ожидалось 1,0522: ${JSON.stringify(r)}`);
  assert.deepEqual([r.num, r.den, r.day, r.same, r.pair], [28.44, 27.03, "2026-11-19", false, true]);
  assert.equal(termLive(row18, v3c18, vqGth20, v3q19), null, "без пары — как в v5.6.1: подмеса нет, на карточке 1,01 за 18.11");
});

test("v5.6.2: после выхода закрытия во FRED — ряд, а с открытием рынка — живая пара той же даты", () => {
  const row19 = { day: "2026-11-19", v: 28.44 / 27.03 }, v3c19 = { day: "2026-11-19", v: 27.03 };
  assert.equal(termLive(row19, v3c19, vqGth20, v3q19, pair19), null, "пара той же даты, что ряд, — не новее: на карточке закрытие 19.11");
  const open = termLive(row19, v3c19, { day: "2026-11-20", v: 29.5 }, { day: "2026-11-20", v: 27.62 }, pair19);
  assert.ok(open && near(open.v, 29.5 / 27.62) && open.day === "2026-11-20" && open.pair === false, "котировки одной даты важнее пары");
});

test("v5.6.2: пара не новее ряда или новее котировки VIX — игнор", () => {
  const row19 = { day: "2026-11-19", v: 28.44 / 27.03 };
  assert.equal(termLive(row19, v3c18, vqGth20, v3q19, { day: "2026-11-18", vix: 30, vix3m: 24 }), null, "пара старше ряда");
  assert.equal(termLive(row19, v3c18, vqGth20, v3q19, { day: "2026-11-19", vix: 30, vix3m: 24 }), null, "пара той же даты, что ряд");
  assert.equal(termLive(row18, v3c18, { day: "2026-11-19", v: 28.44 }, null, { day: "2026-11-20", vix: 30, vix3m: 24 }), null, "пара новее котировки VIX");
});

test("v5.6.2: битая пара — игнор", () => {
  for (const bad of [{ day: "2026-11-19", vix: 0, vix3m: 27.03 }, { day: "2026-11-19", vix: 28.44, vix3m: 400 }, { day: "19.11.2026", vix: 28.44, vix3m: 27.03 },
    { day: "2026-11-19", vix: 28.44 }, { vix: 28.44, vix3m: 27.03 }, { day: "2026-11-19", vix: NaN, vix3m: 27.03 }, "2026-11-19,28.44,27.03", null, undefined])
    assert.equal(termLive(row18, v3c18, vqGth20, v3q19, bad), null, JSON.stringify(bad));
});

test("v5.6.2: подмес по паре — тоже только вверх", () => {
  assert.equal(termLive(row18, v3c18, vqGth20, v3q19, { day: "2026-11-19", vix: 24, vix3m: 24.29 }), null, "0,988 ниже 1,011 ряда");
});

test("v5.6.2: нет ключа — прежнее поведение (снимки до v5.6.2)", () => {
  for (const [a, b, c, d] of [[row18, v3c18, vq19, v3q19], [row18, v3c18, vq19, null], [row18, v3c18, { day: "2026-11-18", v: 26 }, { day: "2026-11-18", v: 24.6 }]])
    assert.deepEqual(termLive(a, b, c, d, undefined), termLive(a, b, c, d, null));
  const r = termLive(row18, v3c18, vq19, v3q19);
  assert.ok(r && r.pair === false && r.day === "2026-11-19" && r.num === 28.44, "живая пара той же даты — как в v5.6.1");
});

test("сборщик v5.6.2: vixPair кладёт пару только при котировках одной даты, иначе переносит прежнюю", () => {
  const csv = (sym, day, v) => `Symbol,Date,Time,Open,High,Low,Close,Volume\n${sym},${day},00:00:00,${v},${v},${v},${v},0`;
  const now = Date.parse("2026-11-20T08:46:00Z");
  assert.deepEqual(vixPair(csv("^VIX", "2026-11-19", 28.44), csv("^VIX3M", "2026-11-19", 27.03), null, now), pair19, "одна дата — свежая пара");
  assert.deepEqual(vixPair(csv("^VIX", "2026-11-20", 29.76), csv("^VIX3M", "2026-11-19", 27.03), pair19, now), pair19, "даты разошлись — прежняя пара");
  assert.equal(vixPair(csv("^VIX", "2026-11-20", 29.76), csv("^VIX3M", "2026-11-19", 27.03), null, now), null, "даты разошлись, прежней нет — ключа нет");
  assert.deepEqual(vixPair(undefined, undefined, pair19, now), pair19, "котировок нет (сбой, дедлайн) — прежняя пара");
  assert.equal(vixPair(undefined, undefined, { day: "2026-11-12", vix: 20, vix3m: 21 }, now), null, "пара старше 7 суток не переносится");
  assert.equal(vixPair(undefined, undefined, { day: "2026-11-19", vix: 0, vix3m: 27 }, now), null, "битая прежняя пара не переносится");
  assert.deepEqual(vixPair(csv("^VIX", "2026-11-18", 24.56), csv("^VIX3M", "2026-11-18", 24.29), pair19, now), pair19, "свежая пара старше прежней не заменяет её");
  assert.deepEqual(vixPair(csv("^VIX", "2026-11-20", 29.5), csv("^VIX3M", "2026-11-20", 27.62), pair19, Date.parse("2026-11-20T14:46:00Z")),
    { day: "2026-11-20", vix: 29.5, vix3m: 27.62 }, "открылся рынок — пара новой даты");
  assert.equal(vixPair(csv("^VIX", "2026-11-19", 3), csv("^VIX3M", "2026-11-19", 27.03), null, now), null, "мусорная котировка");
  assert.equal(valid("cboe:vixpair", pair19), true);
  assert.equal(valid("cboe:vixpair", { day: "2026-11-19", vix: 28.44 }), false);
  assert.equal(valid("cboe:vixpair", "2026-11-19,28.44,27.03"), false, "строка — не форма пары");
});

test("сборщик v5.6.2: пара считается из свежих котировок до слияния и ни в failed, ни в stale_keys не попадает", () => {
  const iq = collector.indexOf("const IQ={"), call = collector.indexOf("vixPair(R[\"stq:^vix\"],R[\"stq:^vix3m\"]"), merge = collector.indexOf("const stale_keys={};");
  assert.ok(iq > 0 && call > iq && merge > call, "вызов vixPair — после котировок и до слияния с прошлым снимком");
  assert.match(collector, /if\(vp&&valid\("cboe:vixpair",vp\)\) R\["cboe:vixpair"\]=vp;/);
  assert.doesNotMatch(collector, /put\("cboe:vixpair"/, "не через put(): расхождение дат — не сбой");
});

test("карточка страницы вызывает termLive и берёт VIX3M из снимка и у CBOE, пару — из снимка", () => {
  assert.match(page, /const v3q= vq\? \(\(await cboeVixQuote\("_VIX3M"\)\)\|\|\(await stooqQuote\("\^vix3m"\)\)\) : null;/);
  assert.match(page, /const vp=snapHas\("cboe:vixpair"\)\?SNAP\.responses\["cboe:vixpair"\]:null;/);
  assert.match(page, /const tl=termLive\(pt\(last\(rows\)\),pt\(last\(v3\)\),pt\(vq\),pt\(v3q\),vp&&typeof vp==="object"\?\{day:String\(vp\.day\|\|""\),vix:\+vp\.vix,vix3m:\+vp\.vix3m\}:null\);/);
  assert.match(page, /rows\.push\(\{d:new Date\(tl\.day\+"T00:00:00Z"\),v:tl\.v\}\)/, "точка — датой пары или котировки");
  assert.doesNotMatch(page, /const nr=vq\.v\/last\(v3\)\.v;/, "прежняя формула со вчерашним знаменателем убрана");
});

test("сборщик: ключ stq:^vix3m снимается сразу за ^vix, первоисточник CBOE, резерв Yahoo", () => {
  const m = collector.match(/const IQ=\{([\s\S]*?)\};/);
  assert.ok(m, "в сборщике нет списка IQ");
  const keys = [...m[1].matchAll(/"([^"]+)":\{y:/g)].map((x) => x[1]);
  assert.deepEqual(keys, ["cl.f", "^vix", "^vix3m", "usdjpy"]);
  assert.match(m[1], /"\^vix3m":\{y:"\^VIX3M",lo:5,hi:150,cboe:"_VIX3M"\}/);
  assert.match(collector, /if\(q\.cboe\)\{ try\{ return await cboeVixCSV\(q\.cboe,sym\.toUpperCase\(\)\); \}catch\(e\)\{\} \}/);
  assert.equal(valid("stq:^vix3m", "Symbol,Date,Time,Open,High,Low,Close,Volume\n^VIX3M,2026-11-19,00:00:00,27.03,27.03,27.03,27.03,0"), true);
  assert.equal(valid("stq:^vix3m", { data: {} }), false, "объект — не форма stq");
});

console.log(`\n${passed} прошло, ${failures} упало`);
process.exit(failures ? 1 : 0);
