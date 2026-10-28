// Тест справочной карточки «Домохозяйства и жильё» (v5.3) и её рядов в сборщике. Без сети и без браузера.
//
// Проверяется ОРИГИНАЛ: ядро карточки исполняется прямо из docs/index.html (⟦HOUSEHOLDS-CORE⟧), лимиты и
// диапазоны здравого смысла читаются со страницы, список серий, ужатие рядов и valid() — из scripts/fetch-snapshot.mjs.
// Фикстура — настоящие ряды FRED на 28.10.2026 в той глубине, что тянет сборщик: по ним сверяются контрольные
// числа задания. Остальные проверки — на рядах, собранных здесь же (дыры, недели, кварталы, зоны, пропавший ряд).
// Запуск: node scripts/households-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let failures = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("ok  ", name); }
  catch (e) { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); }
};

const page = readFileSync("docs/index.html", "utf-8").replace(/\r\n/g, "\n");
const collector = readFileSync("scripts/fetch-snapshot.mjs", "utf-8").replace(/\r\n/g, "\n");
const FIX = JSON.parse(readFileSync("scripts/fixtures/households-fred-2026-10-28.json", "utf-8"));

const core = (() => {
  const m = page.match(/\/\* ⟦HOUSEHOLDS-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/HOUSEHOLDS-CORE⟧ \*\//);
  if (!m) throw new Error("в docs/index.html нет блока ⟦HOUSEHOLDS-CORE⟧");
  return new Function(m[1] + "\nreturn {householdsOf,hhSentiment,hhAgoMonths,hhAgoWeeks,hhSig,hhNum,HH_FROM};")();
})();
const { householdsOf, hhSentiment, hhAgoMonths, hhAgoWeeks, hhSig, HH_FROM } = core;
const objLit = (src, name) => {
  const m = src.match(new RegExp("const " + name + "=\\{([\\s\\S]*?)\\};"));
  if (!m) throw new Error("нет " + name);
  return new Function("return {" + m[1].replace(/\/\*[\s\S]*?\*\//g, "") + "};")();
};
const valid = (() => {
  const m = collector.match(/\nfunction valid\(key,j\)\{[\s\S]*?\n\}\n/);
  if (!m) throw new Error("в сборщике нет function valid(key,j)");
  return new Function(m[0] + "\nreturn valid;")();
})();
const slimFred = (() => {
  const a = collector.match(/\nconst SLIM_FRED=new Set\([^\n]*\);/), b = collector.match(/\nconst slimFred=[\s\S]*?return j; \};/);
  if (!a || !b) throw new Error("в сборщике нет SLIM_FRED/slimFred");
  return new Function(a[0] + b[0] + "\nreturn slimFred;")();
})();

const KEYS = ["UMCSENT", "W875RX1", "EXHOSLUSM495S", "MORTGAGE30US", "DRCCLACBS", "DRSFRMACBS"];
const NOW = Date.UTC(2026, 9, 28, 12);
const ser = (pairs) => pairs.map(([d, v]) => ({ d: new Date(d + "T00:00:00Z"), v }));
const fixture = () => Object.fromEntries(KEYS.map((k) => [k, ser(FIX[k])]));
const rowOf = (r, k) => r.rows.find((x) => x.k === k);
const D = (y, m, d = 1) => new Date(Date.UTC(y, m - 1, d));
const monthly = (y0, m0, vals) => vals.map((v, i) => ({ d: D(y0 + Math.floor((m0 - 1 + i) / 12), ((m0 - 1 + i) % 12) + 1), v }));

/* ---- сборщик и страница: один список рядов, лимиты, здравый смысл ---- */

test("шесть рядов в сборщике и на странице с одинаковой глубиной", () => {
  const coll = objLit(collector, "SERIES"), pg = objLit(page, "SERIES_LIMITS");
  for (const k of KEYS) {
    assert.ok(coll[k] > 0, k + " нет в SERIES сборщика");
    assert.equal(pg[k], coll[k], k + ": глубина на странице ≠ сборщику");
  }
  assert.ok(coll.UMCSENT >= 600, "UMCSENT: нужны все месяцы с 1978 года");
  assert.ok(coll.DRSFRMACBS >= 143 && coll.DRCCLACBS >= 143, "просрочка: весь ряд с 1991 года (ради пика)");
});

test("диапазоны здравого смысла пропускают настоящие ряды и режут мусор", () => {
  const SAN = objLit(page, "SANITY");
  for (const k of KEYS) {
    const [lo, hi] = SAN[k] || [];
    assert.ok(lo != null, k + " нет в SANITY");
    for (const [, v] of FIX[k]) assert.ok(v >= lo && v <= hi, `${k}: ${v} вне [${lo}, ${hi}]`);
  }
  assert.ok(SAN.EXHOSLUSM495S[0] > 1000, "продажи жилья в FRED — штуки (3 990 000), а не миллионы");
});

test("сборщик ужимает новые ряды до даты и значения, valid() их принимает", () => {
  const j = { count: 3, observations: [1, 2, 3, 4].map((i) => ({ realtime_start: "2026-10-28", realtime_end: "2026-10-28", date: "2026-0" + i + "-01", value: String(50 + i) })) };
  const out = slimFred("UMCSENT", JSON.parse(JSON.stringify(j)));
  assert.deepEqual(Object.keys(out.observations[0]), ["date", "value"]);
  assert.ok(valid("fred:UMCSENT", out));
  const old = slimFred("SP500", JSON.parse(JSON.stringify(j)));
  assert.ok("realtime_start" in old.observations[0], "старые ряды не трогаются");
  assert.equal(valid("fred:UMCSENT", { observations: [] }), false);
});

/* ---- контрольные числа задания (FRED на 28.10.2026) ---- */

test("контрольные числа: строки карточки", () => {
  const r = householdsOf(fixture(), NOW);
  const got = Object.fromEntries(r.rows.map((x) => [x.k, [x.val, x.chg, x.date]]));
  assert.deepEqual(got, {
    UMCSENT: ["48,1", "−7,0", "сен 2026"],
    W875RX1: ["17,0 трлн $", "+0,8%", "авг 2026"],
    EXHOSLUSM495S: ["3,99 млн", "−2,2%", "сен 2026"],
    MORTGAGE30US: ["7,32%", "+113 б.п.", "22 окт 2026"],
    DRCCLACBS: ["2,85%", "−0,19 п.п.", "II кв. 2026"],
    DRSFRMACBS: ["1,86%", "+0,08 п.п.", "II кв. 2026"],
  });
  assert.ok(r.rows.every((x) => !x.stale), "при обычном лаге ни одна строка не устаревшая: " + r.rows.filter((x) => x.stale).map((x) => x.k));
});

test("контрольные числа: перцентиль с 1978 года, минимум, зона, подпись с пиком", () => {
  const r = householdsOf(fixture(), NOW);
  assert.equal(r.value, "48,1");
  assert.equal(r.delta, "перцентиль <1 с 1978 года · ниже было только 44,8 (май 2026)");
  assert.equal(r.zi, 0, "у минимума: перцентиль <10");
  assert.match(r.note, /^Настроения у минимума/);
  assert.match(r.note, /Просрочка по ипотеке 1,86% против пика 11,48% \(I кв\. 2010\): жильё упирается в ставки, а не в дефолты\./);
  assert.match(r.note, /пока просрочки и спреды спокойны, балл её не видит\.$/);
  assert.equal(r.date.toISOString().slice(0, 10), "2026-09-01", "дата карточки — дата главного числа");
  const st = hhSentiment(fixture().UMCSENT);
  assert.equal(st.from.toISOString().slice(0, 10), "1978-01-01");
  assert.ok(st.pc > 0 && st.pc < 1, "перцентиль " + st.pc);
  assert.equal(r.series.length, 120, "мини-график — 10 лет помесячно");
  assert.equal(r.series[r.series.length - 1].v, 48.1);
});

/* ---- изменения за год: по календарю, а не по позиции в ряду ---- */

test("г/г по тому же календарному месяцу; дыра в ряду не подменяется соседним месяцем", () => {
  const s = monthly(2025, 1, Array.from({ length: 20 }, (_, i) => 100 + i));   // янв 2025 … авг 2026
  assert.equal(hhAgoMonths(s, 12).d.toISOString().slice(0, 10), "2025-08-01");
  const holed = s.filter((p) => p.d.toISOString().slice(0, 7) !== "2025-08");
  assert.equal(hhAgoMonths(holed, 12), null, "без базы — нет г/г");
  const r = householdsOf({ W875RX1: holed }, NOW);
  assert.equal(rowOf(r, "W875RX1").chg, "—");
  const mid = s.filter((p) => p.d.toISOString().slice(0, 7) !== "2026-03");     // дыра посередине базу не трогает
  assert.equal(rowOf(householdsOf({ W875RX1: mid }, NOW), "W875RX1").chg, "+11,2%");  // 119/107 − 1
  const fx = fixture().W875RX1.filter((p) => p.d.toISOString().slice(0, 7) !== "2026-03");
  assert.equal(rowOf(householdsOf({ W875RX1: fx }, NOW), "W875RX1").chg, "+0,8%");
});

test("Δ за 52 недели: ровно 364 дня; пропущенная неделя — предыдущая; короткий ряд — прочерк", () => {
  const wk = Array.from({ length: 60 }, (_, i) => ({ d: new Date(Date.UTC(2025, 7, 28) + i * 7 * 864e5), v: 6 + i / 100 }));
  const a = hhAgoWeeks(wk, 52);
  assert.equal((+wk[wk.length - 1].d - +a.d) / 864e5, 364);
  const holed = wk.filter((p) => p !== a);
  assert.equal((+holed[holed.length - 1].d - +hhAgoWeeks(holed, 52).d) / 864e5, 371);
  assert.equal(hhAgoWeeks(wk.slice(-50), 52), null);
  const r = householdsOf({ MORTGAGE30US: wk }, NOW);
  assert.equal(rowOf(r, "MORTGAGE30US").chg, "+52 б.п.");
  assert.equal(rowOf(householdsOf({ MORTGAGE30US: wk.slice(-50) }, NOW), "MORTGAGE30US").chg, "—");
});

test("Δ за 4 квартала: тот же квартал годом раньше", () => {
  const q = [[2025, 1, 3.1], [2025, 4, 3.04], [2025, 7, 2.99], [2025, 10, 2.95], [2026, 1, 2.91], [2026, 4, 2.85]].map(([y, m, v]) => ({ d: D(y, m), v }));
  assert.equal(rowOf(householdsOf({ DRCCLACBS: q }, NOW), "DRCCLACBS").chg, "−0,19 п.п.");
  const holed = q.filter((p) => p.d.toISOString().slice(0, 7) !== "2025-04");
  assert.equal(rowOf(householdsOf({ DRCCLACBS: holed }, NOW), "DRCCLACBS").chg, "—");
  assert.equal(rowOf(householdsOf({ DRCCLACBS: q }, NOW), "DRCCLACBS").date, "II кв. 2026");
});

/* ---- перцентиль, зоны, пик ---- */

test("перцентиль считается с 1978 года: квартальные точки раньше не входят", () => {
  const base = monthly(1978, 1, Array.from({ length: 200 }, (_, i) => 60 + (i % 40)));  // 60…99
  const early = [[1975, 2], [1975, 5], [1975, 8], [1975, 11], [1976, 2], [1976, 5], [1976, 8], [1976, 11], [1977, 2], [1977, 5], [1977, 8], [1977, 11]]
    .map(([y, m]) => ({ d: D(y, m), v: 10 }));
  const s = [...early, ...base, { d: D(1994, 9), v: 59 }];
  const st = hhSentiment(s);
  assert.equal(+st.from, HH_FROM);
  assert.equal(st.below.length, 0, "точки до 1978 года ниже текущей, но в окно не входят");
  assert.equal(st.zi, 0);
  assert.equal(householdsOf({ UMCSENT: s }, NOW).delta, "перцентиль <1 с 1978 года · минимум с 1978 года");
});

test("зоны по перцентилю: <10 у минимума, 10…90 норма, >90 эйфория; все без балла", () => {
  const zones = page.match(/addInd\(\{id:"households"[\s\S]*?zones:(\[[^\n]*\]),\n/);
  assert.ok(zones, "нет зон карточки");
  const Z = new Function("return " + zones[1])();
  assert.deepEqual(Z.map((z) => z.s), [0, 0, 0]);
  assert.deepEqual(Z.map((z) => z.l), ["у минимума: перцентиль <10", "норма", "эйфория: перцентиль >90"]);
  const hist = monthly(1978, 1, Array.from({ length: 200 }, (_, i) => i));  // 0…199, текущая точка добавляется последней
  const at = (v) => hhSentiment([...hist, { d: D(1994, 9), v }]);
  assert.equal(at(19.5).zi, 0);      // ниже 20 из 201 → 9,95
  assert.equal(at(20.5).zi, 1);      // 21 из 201 → 10,45
  assert.equal(at(180.5).zi, 2);     // 181 из 201 → 90,05
  assert.equal(at(179.5).zi, 1);     // 180 из 201 → 89,55
  assert.equal(at(250).zi, 2);
  assert.equal(hhSentiment(monthly(2015, 1, Array.from({ length: 100 }, () => 70))).zi, null, "меньше 10 лет — без перцентиля");
});

test("пик просрочки по ипотеке — из ряда, не из кода", () => {
  const f = fixture();
  f.DRSFRMACBS = f.DRSFRMACBS.map((p) => (p.d.toISOString().startsWith("2011-04") ? { d: p.d, v: 12.5 } : p));
  assert.match(householdsOf(f, NOW).note, /против пика 12,50% \(II кв\. 2011\)/);
  const high = fixture();
  high.DRSFRMACBS = [...high.DRSFRMACBS, { d: D(2026, 7), v: 7.2 }];
  const n = householdsOf(high, NOW).note;
  assert.match(n, /Просрочка по ипотеке 7,20% против пика 11,48% \(I кв\. 2010\)\./);
  assert.ok(!/упирается в ставки/.test(n), "у пика нельзя писать «ставки, а не дефолты»");
});

test("подпись про минимум — только в зоне у минимума", () => {
  const f = fixture();
  f.UMCSENT = [...f.UMCSENT, { d: D(2026, 10), v: 90 }];
  const r = householdsOf(f, NOW);
  assert.equal(r.zi, 1);
  assert.ok(!/Настроения у минимума/.test(r.note));
  assert.match(r.note, /^Просрочка по ипотеке/);
});

test("знак минуса U+2212 во всех числах, дефиса перед цифрой нет", () => {
  const f = fixture();
  const r = householdsOf(f, NOW);
  const text = [r.value, r.delta, r.note, ...r.rows.flatMap((x) => [x.val, x.chg, x.date])].join(" | ");
  assert.ok(!/(^|[\s(|])-\d/.test(text), "дефис перед числом: " + text);
  assert.ok(text.includes("−7,0") && text.includes("−2,2%") && text.includes("−0,19 п.п.") && text.includes("(−34%)"));
  assert.equal(hhSig(-0.001, 2), "0,00", "минус-ноль без знака");
  assert.equal(hhSig(0.004, 2), "0,00");
  assert.equal(hhSig(1130 / 10, 0), "+113");
});

/* ---- пропавшие ряды ---- */

test("один ряд не собрался — его строка «нет данных», остальные работают", () => {
  for (const k of KEYS) {
    const f = fixture(); f[k] = null;
    const r = householdsOf(f, NOW);
    assert.equal(r.rows.length, 6);
    assert.ok(rowOf(r, k).miss, k + " должен быть «нет данных»");
    assert.ok(r.rows.filter((x) => x.k !== k).every((x) => !x.miss && x.val && x.chg && x.date), k);
  }
  const f = fixture(); f.DRSFRMACBS = [];
  assert.match(householdsOf(f, NOW).note, /^Настроения у минимума[^]*Слабость домохозяйств доходит до рынка через кредит/);
  assert.ok(!/Просрочка по ипотеке/.test(householdsOf(f, NOW).note));
});

test("без главного ряда: прочерк, без зоны, дата — по свежей строке, графика нет", () => {
  const f = fixture(); f.UMCSENT = null;
  const r = householdsOf(f, NOW);
  assert.equal(r.value, "—");
  assert.equal(r.zi, null);
  assert.equal(r.delta, "");
  assert.equal(r.series, null);
  assert.equal(r.date.toISOString().slice(0, 10), "2026-10-22");
});

test("все ряды пропали — ядро возвращает null (карточка показывает сбой источника)", () => {
  assert.equal(householdsOf({}, NOW), null);
  assert.equal(householdsOf(Object.fromEntries(KEYS.map((k) => [k, null])), NOW), null);
});

test("свежесть по строке: квартальный лаг нормален, недельная ставка без обновления — устаревшая", () => {
  const late = householdsOf(fixture(), Date.UTC(2026, 10, 20));        // 20.11: просрочка за II кв. ещё законна
  assert.ok(!rowOf(late, "DRCCLACBS").stale && !rowOf(late, "DRSFRMACBS").stale);
  assert.ok(rowOf(late, "MORTGAGE30US").stale, "ставка 22.10 на 20.11 — устаревшая");
  const r = householdsOf(fixture(), Date.UTC(2027, 0, 20));
  assert.ok(rowOf(r, "DRCCLACBS").stale, "II кв. к 20.01 — уже устаревший");
});

console.log(`\nдомохозяйства: ${passed} пройдено, ${failures} провалено`);
process.exit(failures ? 1 : 0);
