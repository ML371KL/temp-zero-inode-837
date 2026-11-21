// Тест детектора «Паника при здоровой экономике» (v5.7.0). Без сети и без браузера.
//
// Проверяется ОРИГИНАЛ: ядро ⟦PANIC-CORE⟧ (slowOf, panicOf) исполняется прямо из docs/index.html, веса блоков — из
// BLOCKS страницы. Правило: +15, когда на рынке паника (VIX ≥ 30 или VIX/VIX3M ≥ 1,05), а медленный балл — кредит,
// экономика и ликвидность без рыночных и быстрых карточек — выше +10. Меньше 10 из 15 медленных карточек с данными —
// балла нет и поправки нет. Контроль — живой снимок 21.11.2026: медленный балл +21,8, VIX 35,9, отношение 1,16 → +15.
// Запуск: node scripts/panic-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let failures = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("ok  ", name); }
  catch (e) { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); }
};

const page = readFileSync("docs/index.html", "utf-8").replace(/\r\n/g, "\n");
const { PANIC, PANIC_FAST, slowOf, panicOf } = (() => {
  const m = page.match(/\/\* ⟦PANIC-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/PANIC-CORE⟧ \*\//);
  if (!m) throw new Error("в docs/index.html нет блока ⟦PANIC-CORE⟧");
  return new Function(m[1] + "\nreturn {PANIC,PANIC_FAST,slowOf,panicOf};")();
})();
const BLOCKS = (() => {
  const m = page.match(/\nconst BLOCKS=(\{[\s\S]*?\n\});/);
  if (!m) throw new Error("в docs/index.html нет const BLOCKS");
  return new Function("return " + m[1])();
})();
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// Карточки с баллом — те же блоки и семьи, что на странице; три справочные (info) в балл не идут.
const CARDS = [
  ["sofr_iorb", "plumb", "price"], ["netliq", "plumb", "qty"], ["reserves", "plumb", "qty"], ["rrp", "plumb", "qty"],
  ["nfci", "plumb", "nfci"], ["srf", "plumb", "price"], ["ratevol", "plumb", "price"],
  ["hy", "credit", "hy"], ["hy_mom", "credit", "hy"], ["ig", "credit", "ig"], ["sloos", "credit", "sloos"],
  ["spx", "market", "spx"], ["spx_mom", "market", "spx"], ["vix", "market", "vix"], ["vixterm", "market", "vixterm"],
  ["payrolls", "macro", "payrolls"], ["sahm", "macro", "sahm"], ["claims", "macro", "claims"], ["curve", "macro", "curve"],
  ["real10", "macro", "real10"], ["policy", "macro", "policy"],
  ["jpy", "regime", "jpy"], ["goldreal", "regime", "goldreal"], ["btc", "regime", "btc"], ["stagf", "regime", "stagf"],
  ["oil", "regime", "oil"], ["cny", "regime", "cny"], ["dxy", "regime", "dxy"],
];
const INFO = [["tga", "plumb"], ["bizd", "credit"], ["breadth", "market"]];
const IND = [...CARDS.map(([id, block, family]) => ({ id, block, family })), ...INFO.map(([id, block]) => ({ id, block, info: true }))];
const scoreOf = (i, r) => r.s;
// Баллы карточек на живом снимке 21.11.2026 (данные 19–20.11): HY 352 → −1, рынок в панике.
const LIVE = { sofr_iorb: 0, netliq: 1, reserves: -1, rrp: 0, nfci: 1, srf: 1, ratevol: 0, hy: -1, hy_mom: 0, ig: 2, sloos: 0,
  spx: -1, spx_mom: -1, vix: -2, vixterm: -2, payrolls: 1, sahm: 2, claims: 0, curve: 1, real10: 0, policy: -1,
  jpy: 0, goldreal: -1, btc: -1, stagf: 0, oil: 0, cny: 0, dxy: -1, tga: 1, bizd: -1, breadth: 0 };
const dataOf = (o) => Object.fromEntries(Object.entries(o).map(([k, s]) => [k, s == null ? null : { zi: 0, s }]));

test("правило: пороги и поправка — VIX 30, VIX/VIX3M 1,05, медленный балл > +10, +15, не меньше 10 карточек", () => {
  assert.deepEqual(PANIC, { vix: 30, term: 1.05, slow: 10, pts: 15, minSlow: 10 });
});

test("быстрые карточки — рынок, режимы, вола ставок, импульс HY; все они есть на странице", () => {
  assert.deepEqual([...PANIC_FAST].sort(), ["btc", "cny", "dxy", "goldreal", "hy_mom", "jpy", "oil", "ratevol", "spx", "spx_mom", "stagf", "vix", "vixterm"]);
  for (const id of [...PANIC_FAST, "sofr_iorb", "netliq", "reserves", "rrp", "nfci", "srf", "hy", "ig", "sloos", "payrolls", "sahm", "claims", "curve", "real10", "policy"])
    assert.ok(page.includes(`addInd({id:"${id}"`), "на странице нет карточки " + id);
});

test("живой снимок 21.11.2026: медленный балл +21,8 по 15 карточкам, паника VIX 35,9 / 1,16 → АКТИВЕН, +15", () => {
  const S = slowOf(BLOCKS, IND, dataOf(LIVE), scoreOf);
  assert.equal(S.n, 15);
  assert.ok(near(S.score, (25 * 25 + (100 / 6) * 25 + 25 * 15) / 65), String(S.score));   // ликвидность 25, кредит 16,7, макро 25
  assert.equal(Math.round(S.score * 10) / 10, 21.8);
  assert.deepEqual(panicOf(35.89, 1.16, S.score), { panic: true, healthy: true, on: true, pts: 15 });
});

test("быстрые и справочные карточки медленный балл не двигают", () => {
  const base = slowOf(BLOCKS, IND, dataOf(LIVE), scoreOf).score;
  const moved = { ...LIVE };
  for (const id of PANIC_FAST) moved[id] = moved[id] >= 0 ? -2 : 2;
  moved.tga = -2; moved.bizd = 2; moved.breadth = -2;
  assert.ok(near(slowOf(BLOCKS, IND, dataOf(moved), scoreOf).score, base));
});

test("медленные карточки двигают: IG от 100 → +15,4 (поправка остаётся); и NFCI выше −0,3 → +9,0 (поправки нет)", () => {
  const ig = slowOf(BLOCKS, IND, dataOf({ ...LIVE, ig: 1 }), scoreOf).score;
  assert.equal(Math.round(ig * 10) / 10, 15.4);
  assert.equal(panicOf(35.9, 1.16, ig).pts, 15);
  const both = slowOf(BLOCKS, IND, dataOf({ ...LIVE, ig: 1, nfci: 0 }), scoreOf).score;
  assert.equal(Math.round(both * 10) / 10, 9.0);
  assert.deepEqual(panicOf(35.9, 1.16, both), { panic: true, healthy: false, on: false, pts: 0 });
});

test("границы: паника включительно (30 и 1,05), здоровье строго выше +10, нет данных — нет поправки", () => {
  assert.equal(panicOf(29.99, 1.049, 50).pts, 0);
  assert.equal(panicOf(30, null, 10.01).pts, 15);
  assert.equal(panicOf(null, 1.05, 10.01).pts, 15);
  assert.equal(panicOf(29.99, 1.05, 10.01).pts, 15);
  assert.equal(panicOf(35, 1.2, 10).pts, 0);
  assert.equal(panicOf(35, 1.2, null).pts, 0);
  assert.equal(panicOf(undefined, undefined, 40).pts, 0);
  assert.equal(panicOf(NaN, NaN, 40).pts, 0);
  assert.deepEqual(panicOf(18, 0.9, 40), { panic: false, healthy: true, on: false, pts: 0 });
});

test("меньше 10 из 15 медленных карточек с данными — балла нет и поправки нет", () => {
  const thin = { ...LIVE };
  for (const id of ["sofr_iorb", "netliq", "reserves", "rrp", "nfci", "srf"]) thin[id] = null;   // осталось 9
  const S = slowOf(BLOCKS, IND, dataOf(thin), scoreOf);
  assert.equal(S.n, 9); assert.equal(S.score, null);
  assert.equal(panicOf(40, 1.2, S.score).pts, 0);
  delete thin.sofr_iorb; thin.srf = 1;                                                          // 10 — уже считается
  assert.equal(slowOf(BLOCKS, IND, dataOf(thin), scoreOf).n, 10);
  assert.notEqual(slowOf(BLOCKS, IND, dataOf(thin), scoreOf).score, null);
});

test("страница: детектор d_panic считает по ядру, термструктура кладёт отношение в state.vixTerm", () => {
  assert.match(page, /\{id:"d_panic",triad:false,name:"Паника при здоровой экономике"/);
  assert.match(page, /const S=slowOf\(BLOCKS,IND,state\.data,scoreOf\), vix=state\.vix\?\?null, term=state\.vixTerm\?\?null;/);
  assert.match(page, /const P=panicOf\(vix,term,S\.score\);/);
  assert.match(page, /const r=last\(rows\)\.v;\n {3}state\.vixTerm=r;/);
  assert.ok(page.indexOf('{id:"d_panic"') > page.indexOf("const DETECTORS=["), "детектор вне массива DETECTORS");
});

console.log(`\n${passed} ok, ${failures} fail`);
process.exit(failures ? 1 : 0);
