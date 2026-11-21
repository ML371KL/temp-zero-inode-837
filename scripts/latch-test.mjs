// Тест удержания детектора капекса до развязки (v5.8.0). Без сети и без браузера.
//
// Проверяется ОРИГИНАЛ: ядро ⟦LATCH-CORE⟧ (basketRelSince, sessionsAfter, capexLatchStep) исполняется прямо из
// docs/index.html. Правило: СРАБОТАЛ капекса держится и после 14-дневного окна новостей, пока корзина капекса с закрытия
// дня срабатывания отстаёт от S&P (медиана доходностей тикеров минус SPY, не меньше 3 тикеров), и не дольше 63 сессий
// после последнего дня, когда СРАБОТАЛ давали сами новости. Память эпизода — cx памяти ступени {since, last}.
// Контроль — эпизод 6.10.2026: к 20.11 корзина отстала от S&P (MSFT −8,3%, GOOGL −23,7%, AMZN −3,7%, META −24,1%,
// ORCL −29,8%, CRWV −56,9% против SPY −11,5%; медиана −23,9% → −12,4 п.п.).
// Запуск: node scripts/latch-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let failures = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("ok  ", name); }
  catch (e) { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); }
};

const page = readFileSync("docs/index.html", "utf-8").replace(/\r\n/g, "\n");
const { LATCH, basketRelSince, sessionsAfter, capexLatchStep } = (() => {
  const m = page.match(/\/\* ⟦LATCH-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/LATCH-CORE⟧ \*\//);
  if (!m) throw new Error("в docs/index.html нет блока ⟦LATCH-CORE⟧");
  return new Function(m[1] + "\nreturn {LATCH,basketRelSince,sessionsAfter,capexLatchStep};")();
})();
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
// ряд как у ypx(): {d: Date, c, a} по сессиям; days — даты ISO
const ser = (days, vals) => days.map((d, k) => ({ d: new Date(d + "T14:30:00Z"), c: vals[k], a: vals[k] }));
const D = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-11-19", "2026-11-20"];

test("правило: 63 сессии после последнего факта, не меньше 3 тикеров", () => {
  assert.deepEqual(LATCH, { maxSessions: 63, minTickers: 3 });
});

test("отставание корзины: медиана тикеров с закрытия дня срабатывания минус SPY, контроль 6.10.2026", () => {
  const spy = ser(D, [101, 100, 99, 90, 88.5]);                           // SPY с 6.10: −11,5%
  const r = { MSFT: -8.3, GOOGL: -23.7, AMZN: -3.7, META: -24.1, ORCL: -29.8, CRWV: -56.9 };
  const baskets = Object.entries(r).map(([t, x]) => [t, ser(D, [100, 100, 100, 100, 100 * (1 + x / 100)])]);
  const rel = basketRelSince(baskets, spy, "2026-10-06");
  assert.ok(near(rel, ((-23.7 - 24.1) / 2 / 100 + 0.115) * 100, 1e-9), String(rel));
  assert.equal(Math.round(rel * 10) / 10, -12.4);
});

test("один тикер не решает: медиана, а не среднее", () => {
  const spy = ser(D, [100, 100, 100, 100, 100]);
  const flat = [1, 2, 3, 4].map(k => ["T" + k, ser(D, [100, 100, 100, 100, 100])]);
  const crash = ["X", ser(D, [100, 100, 100, 100, 20])];                   // −80% у одного
  assert.ok(near(basketRelSince([...flat, crash], spy, "2026-10-06"), 0));
});

test("день между сессиями — закрытие последней сессии до него; ряда до дня нет — тикер не считается", () => {
  const spy = ser(D, [100, 100, 110, 110, 110]);
  const b = [1, 2, 3].map(k => ["T" + k, ser(D, [100, 100, 100, 100, 99])]);
  assert.ok(near(basketRelSince(b, spy, "2026-10-08"), -1));            // от закрытия 7.10: корзина −1%, SPY 0%
  const late = [1, 2, 3].map(k => ["T" + k, ser(D.slice(2), [100, 100, 99])]);   // ряды начинаются после дня
  assert.equal(basketRelSince(late, spy, "2026-10-06"), null);
  assert.equal(basketRelSince([["A", ser(D, [1, 1, 1, 1, 1])]], spy, "2026-10-06"), null, "меньше 3 тикеров");
  assert.equal(basketRelSince(b, null, "2026-10-06"), null, "нет SPY");
});

test("сессии после последнего факта — по ряду SPY, строго после даты и не позже сегодняшней", () => {
  const spy = ser(D, [1, 1, 1, 1, 1]);
  assert.equal(sessionsAfter(spy, "2026-10-06", "2026-11-20"), 3);
  assert.equal(sessionsAfter(spy, "2026-10-06", "2026-11-19"), 2);
  assert.equal(sessionsAfter(spy, "2026-11-20", "2026-11-20"), 0);
  assert.equal(sessionsAfter(null, "2026-10-06", "2026-11-20"), null);
});

test("шаг: новости дали СРАБОТАЛ — эпизод начинается или продолжается, last = сегодня", () => {
  assert.deepEqual(capexLatchStep(null, true, "2026-10-06", null, null), { cx: { since: "2026-10-06", last: "2026-10-06" }, hold: false, off: null });
  assert.deepEqual(capexLatchStep({ since: "2026-10-06", last: "2026-10-13" }, true, "2026-11-02", -9, 14),
    { cx: { since: "2026-10-06", last: "2026-11-02" }, hold: false, off: null }, "начало эпизода не сдвигается");
});

test("шаг: новостей нет — держит, пока корзина отстаёт и срок не вышел", () => {
  const cx = { since: "2026-10-06", last: "2026-10-13" };
  assert.deepEqual(capexLatchStep(cx, false, "2026-11-20", -12.4, 28), { cx, hold: true, off: null });
  assert.deepEqual(capexLatchStep(cx, false, "2026-11-20", null, 28), { cx, hold: true, off: null }, "нет данных по корзине — держит");
  assert.deepEqual(capexLatchStep(cx, false, "2026-11-20", -0.01, 63), { cx, hold: true, off: null }, "63-я сессия ещё держит");
});

test("шаг: развязка — корзина отыграла отставание (≥ 0), срок — больше 63 сессий", () => {
  const cx = { since: "2026-10-06", last: "2026-10-13" };
  assert.deepEqual(capexLatchStep(cx, false, "2026-12-01", 0, 30), { cx: null, hold: false, off: "resolved" });
  assert.deepEqual(capexLatchStep(cx, false, "2026-12-01", 3.2, 30), { cx: null, hold: false, off: "resolved" });
  assert.deepEqual(capexLatchStep(cx, false, "2027-01-20", -20, 64), { cx: null, hold: false, off: "term" });
  assert.deepEqual(capexLatchStep(cx, false, "2027-01-20", null, 64), { cx: null, hold: false, off: "term" });
});

test("шаг: эпизода нет или память битая — удержания нет", () => {
  for (const bad of [null, undefined, {}, { since: "2026-10-06" }, { since: "06.10.2026", last: "2026-10-13" }, "x", 5])
    assert.deepEqual(capexLatchStep(bad, false, "2026-11-20", -10, 5), { cx: null, hold: false, off: null }, JSON.stringify(bad));
});

test("страница: капекс держит по ядру, память эпизода — в памяти ступени, источник памяти — как у машины", () => {
  assert.match(page, /const L=capexLatchStep\(pcx,D\.st==="fired",day,rel,sess\);\n {4}state\.capexLatch=L\.cx;/);
  assert.match(page, /if\(L\.hold\) return \{st:"fired",pts:-15,co:\[\],latched:true,/);
  assert.match(page, /rel=basketRelSince\(CONFIG\.CYCLE\.capexTickers\.map\(t=>\[t,ypx\(t\)\]\),spy,pcx\.since\);/);
  assert.match(page, /const memory=\{v:2,rung:cur,since,pend,pendSession,lastMove,cx:state\.capexLatch\?\?null\};/);
  assert.match(page, /const dataAsOf=dataAsOfNow\(\);/);
  // источник памяти до шага — тот же порядок, что в compute(): писатель → журнал сервера → браузер
  const fn = page.match(/function prevRungMemory\(\)\{[\s\S]*?\n\}/)[0];
  assert.ok(fn.indexOf("W.memory") < fn.indexOf("state.ledger") && fn.indexOf("state.ledger") < fn.indexOf("razlom26.rung.v2"));
  assert.match(page, /if\(W\)\{ mem=validMem\(W\.memory\); source="writer"; \}\n {2}else if\(state\.ledger&&validMem\(state\.ledger\.memory\)\)/);
  assert.match(page, /Удержание \(v5\.8\): СРАБОТАЛ держится и после окна новостей/);
});

console.log(`\n${passed} ok, ${failures} fail`);
process.exit(failures ? 1 : 0);
