// Тест внутридневной термструктуры VIX (v5.6.1). Без сети и без браузера.
//
// Проверяется ОРИГИНАЛ: ядро ⟦VIXTERM-CORE⟧ (termLive) исполняется прямо из docs/index.html, форма ключа
// stq:^vix3m — настоящей функцией valid() сборщика. Правило: числитель и знаменатель отношения — одной даты.
// До v5.6.1 вечером шокового дня сегодняшний VIX делился на вчерашнее закрытие VIX3M (19.11.2026: 1,17 при
// настоящих 1,05) и карточка уходила в зону «событие» при норме или паритете.
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

test("карточка страницы вызывает termLive и берёт VIX3M из снимка и у CBOE", () => {
  assert.match(page, /const v3q= vq\? \(\(await cboeVixQuote\("_VIX3M"\)\)\|\|\(await stooqQuote\("\^vix3m"\)\)\) : null;/);
  assert.match(page, /const tl=termLive\(pt\(last\(rows\)\),pt\(last\(v3\)\),pt\(vq\),pt\(v3q\)\);/);
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
