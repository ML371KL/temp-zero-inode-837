// Тест раскладки общего балла на пункты (полосы блоков, v5.2). Без сети и без браузера.
//
// Проверяется ОРИГИНАЛ: ядро ⟦BREAKDOWN-CORE⟧ и функция aggregate() движка (та же арифметика композита,
// что питает «что изменит решение») исполняются прямо из docs/index.html. Инвариант: Σ пунктов блоков +
// поправки детекторов = общий балл до обрезки ±100, точность 1e-9. Живой снимок проверяет
// scripts/engine-test.mjs в настоящем Chrome. Запуск: node scripts/breakdown-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let failures = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("ok  ", name); }
  catch (e) { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); }
};

const page = readFileSync("docs/index.html", "utf-8").replace(/\r\n/g, "\n");
const grab = (re, what) => { const m = page.match(re); if (!m) throw new Error("на странице нет " + what); return m[1] ?? m[0]; };
const coreSrc = grab(/\/\* ⟦BREAKDOWN-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/BREAKDOWN-CORE⟧ \*\//, "блока ⟦BREAKDOWN-CORE⟧");
const aggSrc = grab(/\nfunction aggregate\(over\)\{[\s\S]*?\n\}\n/, "function aggregate(over)");
const scoreSrc = grab(/\nconst scoreOf=[^\n]*\n/, "const scoreOf");
const { breakdownOf } = new Function(coreSrc + "\nreturn {breakdownOf};")();
const scoreOf = new Function(scoreSrc + "\nreturn scoreOf;")();
const aggregateWith = (BLOCKS, IND, state) => new Function("BLOCKS", "IND", "state", "scoreOf", aggSrc + "\nreturn aggregate;")(BLOCKS, IND, state, scoreOf);

const ZONES = [{ s: 2 }, { s: 1 }, { s: 0 }, { s: -1 }, { s: -2 }];
const zi = (s) => ZONES.findIndex((z) => z.s === s);
const BLOCKS = {
  plumb: { w: 25 }, credit: { w: 25 }, market: { w: 20 }, macro: { w: 15 }, regime: { w: 15 },
  indices: { w: 0, ctx: true, ref: true }, context: { w: 0, ctx: true },
};
const card = (id, block, o = {}) => ({ id, block, zones: ZONES, name: o.name || id, ...o });
// Набор по образцу живой панели: составные семьи, одиночные карточки, справочные (info) в обычных и ctx-блоках.
const IND = [
  card("sofr", "plumb", { family: "price" }), card("netliq", "plumb", { family: "qty" }), card("res", "plumb", { family: "qty" }),
  card("tga", "plumb", { info: true }), card("rrp", "plumb", { family: "qty" }), card("nfci", "plumb"),
  card("srf", "plumb", { family: "price" }), card("ratevol", "plumb", { family: "price" }),
  card("hy", "credit", { family: "hy" }), card("hy_mom", "credit", { family: "hy" }), card("ig", "credit"), card("sloos", "credit"),
  card("bizd", "credit", { info: true, optional: true }),
  card("spx", "market", { family: "spx" }), card("spx_mom", "market", { family: "spx" }), card("vix", "market"), card("vixterm", "market"),
  card("breadth", "market", { info: true, optional: true }), card("opt_mkt", "market", { optional: true }),
  card("payrolls", "macro"), card("sahm", "macro"), card("claims", "macro"), card("curve", "macro"), card("real10", "macro"), card("policy", "macro", { family: "policy" }),
  card("jpy", "regime"), card("gold", "regime"), card("btc", "regime"), card("stagf", "regime"), card("oil", "regime"), card("cny", "regime"), card("dxy", "regime"),
  card("credit_q", "context", { info: true }), card("ai_bet", "context", { info: true }),
];
// Живой снимок 27.10.2026 (контрольные числа задания)
const LIVE = { sofr: 0, netliq: -1, res: -1, tga: -1, rrp: 0, nfci: 1, srf: 1, ratevol: 0, hy: 1, hy_mom: -1, ig: 2, sloos: 0, bizd: 0,
  spx: 2, spx_mom: 0, vix: 0, vixterm: 1, breadth: 0, payrolls: 0, sahm: 2, claims: 1, curve: -1, real10: 0, policy: -1,
  jpy: 0, gold: 0, btc: 1, stagf: 0, oil: -1, cny: 0, dxy: 0, credit_q: -2, ai_bet: 0 };
const dataOf = (scores) => Object.fromEntries(Object.entries(scores).filter(([, s]) => s != null).map(([id, s]) => [id, { zi: zi(s), value: String(s) }]));
const DETS = [{ id: "d_fund", st: "calm", pts: 0 }, { id: "d_capex", st: "fired", pts: -15 }, { id: "d_bdc", st: "calm", pts: 0 },
  { id: "d_oil", st: "watch", pts: -4 }, { id: "d_infl", st: "calm", pts: 0 }, { id: "d_pivot", st: "calm", pts: 0 }, { id: "d_turn", st: "calm", pts: 0 }];

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const check = (data, dets, label) => {
  const bd = breakdownOf(BLOCKS, IND, data, scoreOf, dets);
  const agg = aggregateWith(BLOCKS, IND, { data })({}).composite;
  const det = dets.reduce((a, d) => a + d.pts, 0);
  assert.ok(near(bd.blocksSum, agg), `${label}: Σ пунктов блоков ${bd.blocksSum} ≠ композит движка ${agg}`);
  assert.ok(near(bd.total, agg + det), `${label}: Σ + детекторы ${bd.total} ≠ ${agg + det}`);
  assert.ok(near(bd.det, det), `${label}: детекторы ${bd.det} ≠ ${det}`);
  for (const r of bd.rows) {
    if (r.score == null) { assert.equal(r.pts, 0); continue; }
    assert.ok(near(r.fams.reduce((a, f) => a + f.pts, 0), r.pts), `${label}/${r.id}: Σ семей ≠ пункты блока`);
    assert.ok(near(r.pts, r.score * r.w / bd.tw), `${label}/${r.id}: пункты ≠ балл × w / Σw`);
    assert.ok(near(r.score, r.fams.reduce((a, f) => a + f.mean, 0) / r.fams.length * 50), `${label}/${r.id}: балл ≠ среднее семей × 50`);
  }
  return bd;
};

test("живой снимок 27.10: блоки, семьи, детекторы — контрольные числа", () => {
  const bd = check(dataOf(LIVE), DETS, "живой");
  const B = Object.fromEntries(bd.rows.map((r) => [r.id, r]));
  const r2 = (x) => Math.round(x * 100) / 100;
  assert.deepEqual(bd.rows.map((r) => r.id), ["plumb", "credit", "market", "macro", "regime"], "порядок I–V, ctx-блоков нет");
  assert.deepEqual(bd.rows.map((r) => r2(r.score)), [11.11, 33.33, 33.33, 8.33, 0]);
  assert.deepEqual(bd.rows.map((r) => r2(r.pts)), [2.78, 8.33, 6.67, 1.25, 0]);
  assert.equal(r2(bd.blocksSum), 19.03);
  assert.equal(bd.det, -19);
  assert.equal(r2(bd.total), 0.03);
  assert.equal(bd.tw, 100);
  const F = (b, k) => B[b].fams.find((f) => f.key === k);
  assert.deepEqual(B.plumb.fams.map((f) => f.key), ["price", "qty", "nfci"], "порядок семей — как карточки на странице");
  assert.deepEqual([r2(F("plumb", "price").mean), r2(F("plumb", "price").pts)], [0.33, 1.39]);
  assert.deepEqual([r2(F("plumb", "qty").mean), r2(F("plumb", "qty").pts)], [-0.67, -2.78]);
  assert.equal(r2(F("plumb", "nfci").pts), 4.17);
  assert.equal(r2(F("credit", "ig").pts), 8.33);
  assert.equal(F("credit", "hy").mean, 0);
  assert.equal(r2(F("market", "spx").pts), 3.33);
  assert.equal(r2(F("market", "vixterm").pts), 3.33, "термструктура VIX — 3,33, а не прежние 3,4");
  assert.deepEqual(["sahm", "claims", "curve", "policy"].map((k) => r2(F("macro", k).pts)), [2.5, 1.25, -1.25, -1.25]);
  assert.deepEqual(["btc", "oil"].map((k) => r2(F("regime", k).pts)), [1.07, -1.07]);
  assert.ok(!bd.rows.some((r) => r.fams.some((f) => f.cards.some((c) => c.info))), "справочные карточки не участвуют");
  assert.deepEqual(B.market.missing.map((c) => c.id), [], "необязательная карточка без данных — не «выпала»");
});

test("выпавший блок: Σw < 100, пункты пересчитаны на сумму весов блоков с данными", () => {
  const s = { ...LIVE }; for (const id of ["payrolls", "sahm", "claims", "curve", "real10", "policy"]) s[id] = null;
  const bd = check(dataOf(s), DETS, "без макро");
  assert.equal(bd.tw, 85);
  const macro = bd.rows.find((r) => r.id === "macro");
  assert.equal(macro.score, null);
  assert.deepEqual(macro.missing.map((c) => c.id), ["payrolls", "sahm", "claims", "curve", "real10", "policy"]);
  assert.ok(near(bd.rows.find((r) => r.id === "credit").pts, 100 / 3 * 25 / 85));
});

test("выпавшие карточки внутри блока: семья считается по оставшимся", () => {
  const s = { ...LIVE, spx_mom: null, netliq: null, hy: null };
  const bd = check(dataOf(s), DETS, "частично");
  const m = bd.rows.find((r) => r.id === "market");
  assert.deepEqual(m.fams.find((f) => f.key === "spx").cards.map((c) => c.id), ["spx"]);
  assert.deepEqual(bd.rows.find((r) => r.id === "plumb").missing.map((c) => c.id), ["netliq"]);
});

test("обрезка: сумма за +100 видна в total, а не теряется", () => {
  const s = Object.fromEntries(Object.keys(LIVE).map((id) => [id, 2]));
  const dets = [{ id: "d_turn", st: "good", pts: 10 }, { id: "d_pivot", st: "watch", pts: 5 }];
  const bd = check(dataOf(s), dets, "обрезка+");
  assert.ok(near(bd.blocksSum, 100));
  assert.ok(near(bd.total, 115));
  assert.equal(Math.max(-100, Math.min(100, bd.total)), 100);
  const neg = check(dataOf(Object.fromEntries(Object.keys(LIVE).map((id) => [id, -2]))), [{ id: "d_fund", st: "fired", pts: -10 }], "обрезка−");
  assert.ok(near(neg.total, -110));
});

test("нет данных совсем: пунктов нет, сумма — только детекторы", () => {
  const bd = check({}, DETS, "пусто");
  assert.equal(bd.tw, 0);
  assert.equal(bd.blocksSum, 0);
  assert.equal(bd.total, -19);
});

test("случайный перебор 500 снимков: инвариант держится до 1e-9", () => {
  let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 500; k++) {
    const s = Object.fromEntries(Object.keys(LIVE).map((id) => [id, rnd() < 0.12 ? null : [-2, -1, 0, 1, 2][Math.floor(rnd() * 5)]]));
    if (rnd() < 0.15) for (const id of IND.filter((i) => i.block === "credit").map((i) => i.id)) s[id] = null;
    const dets = DETS.map((d) => ({ ...d, pts: rnd() < 0.3 ? [-15, -10, -4, 5, 10][Math.floor(rnd() * 5)] : 0 }));
    check(dataOf(s), dets, "перебор " + k);
  }
});

test("страница: раскладка питает полосы и фразу, движок не тронут", () => {
  assert.match(page, /BD=breakdownOf\(BLOCKS,IND,state\.data,scoreOf,DETECTORS\.map\(/);
  assert.match(page, /BD\.rows\.forEach\(r=>r\.fams\.forEach\(f=>famList\.push\(\{name:famLabel\(r\.id,f\),pts:f\.pts\}\)\)\)/, "«Поддерживают… / Давят…» — из точной раскладки");
  assert.match(page, /try\{ if\(BD\) renderBars\(BD,\{/, "сбой витрины не задевает решение");
  assert.match(page, /const T1=-10, T2=-30, G=-10, HYST=3, PCT=\[0,50,100\], LOW=30, LOWLEAD=10;/);
  assert.match(page, /\(score>=LOW&&leadScore>=LOWLEAD\)\?"low":"moderate"/);
  assert.doesNotMatch(page, /whyList|famPts/, "прежний список и округлённые веса убраны");
  assert.match(page, /<div id="blockBars"><\/div>/);
});

console.log(`тестов пройдено: ${passed}, провалов: ${failures}`);
if (failures) process.exit(1);
