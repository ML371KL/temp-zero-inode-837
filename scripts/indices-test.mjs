// Тест справочного блока «Индексы» (v5.1) и ключей сборщика yix:*. Без сети и без браузера.
//
// Проверяется ОРИГИНАЛ, а не копия: ядро блока исполняется прямо из docs/index.html (⟦INDICES-CORE⟧),
// валидатор формы — функцией valid(), извлечённой из scripts/fetch-snapshot.mjs. Урок v4.15: проверка
// копией условия пропустила строковый ключ, отсечённый общим «не объект → false», и прод упал.
// Запуск: node scripts/indices-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let failures = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("ok  ", name); }
  catch (e) { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); }
};

const page = readFileSync("docs/index.html", "utf-8").replace(/\r\n/g, "\n");
const collector = readFileSync("scripts/fetch-snapshot.mjs", "utf-8").replace(/\r\n/g, "\n");

const core = (() => {
  const m = page.match(/\/\* ⟦INDICES-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/INDICES-CORE⟧ \*\//);
  if (!m) throw new Error("в docs/index.html нет блока ⟦INDICES-CORE⟧");
  return new Function(m[1] + "\nreturn {IDX,tailOf,trendOf,narrowOf};")();
})();
const valid = (() => {
  const m = collector.match(/\nfunction valid\(key,j\)\{[\s\S]*?\n\}\n/);
  if (!m) throw new Error("в сборщике нет function valid(key,j)");
  return new Function(m[0] + "\nreturn valid;")();
})();
const { IDX, tailOf, trendOf, narrowOf } = core;
const byK = Object.fromEntries(IDX.map((x) => [x.k, x]));

/* ---- риск падения на 10%+ за 3 мес. ---- */

// Контрольные значения подгонки 2000–2026 (реплика движка v5), в процентах с одним знаком.
const TABLE = {
  spx: { A: 1.6074, B: 0.03888, pts: [8.4, 16.7, 25.7, 39.2], avg: 17 },
  dia: { A: 1.7203, B: 0.03794, pts: [7.7, 15.2, 23.3, 35.8], avg: 16 },
  qqq: { A: 1.0841, B: 0.03647, pts: [14.0, 25.3, 36.0, 50.2], avg: 24 },
  iwm: { A: 1.1476, B: 0.02674, pts: [15.7, 24.1, 31.6, 41.4], avg: 23 },
  rsp: { A: 1.6600, B: 0.03753, pts: [8.2, 16.0, 24.3, 37.0], avg: 14 },
};
const SCORES = [20, 0, -14, -30];

test("пять индексов в порядке таблицы, у каждого фонд, кроме S&P", () => {
  assert.deepEqual(IDX.map((x) => x.k), ["spx", "dia", "qqq", "iwm", "rsp"]);
  assert.deepEqual(IDX.map((x) => x.fund || null), [null, "DIA", "QQQ", "IWM", "RSP"]);
});

test("коэффициенты и средняя частота — из подгонки", () => {
  for (const [k, t] of Object.entries(TABLE)) {
    assert.equal(byK[k].A, t.A, k + ".A");
    assert.equal(byK[k].B, t.B, k + ".B");
    assert.equal(byK[k].avg, t.avg, k + ".avg");
  }
});

test("формула риска даёт контрольные значения таблицы", () => {
  for (const [k, t] of Object.entries(TABLE))
    SCORES.forEach((s, i) => {
      const p = tailOf(byK[k], s) * 100;
      assert.ok(Math.abs(p - t.pts[i]) < 0.051, `${k} при балле ${s}: ${p.toFixed(3)}% против ${t.pts[i]}%`);
    });
});

test("риск монотонно падает с баллом и лежит в (0, 1)", () => {
  for (const x of IDX) for (let s = -100; s < 100; s += 5) {
    const a = tailOf(x, s), b = tailOf(x, s + 5);
    assert.ok(a > 0 && a < 1 && b < a, `${x.k} при ${s}`);
  }
});

test("карточка риска вердикта считается той же формулой, что строка S&P", () => {
  assert.match(page, /const tailP= noData\?null: tailOf\(IDX\[0\],score\)/);
  assert.equal(IDX[0].k, "spx");
  // прежняя запись формулы страницы — бит в бит та же арифметика
  for (let s = -100; s <= 100; s += 0.5) assert.equal(tailOf(IDX[0], s), 1 / (1 + Math.exp(1.6074 + 0.03888 * s)));
  assert.match(page, /TAIL_BASE=0\.17/);
});

test("блок «Индексы» справочный: ctx, вне ИИ-разбора, сбой справки не задевает решение", () => {
  assert.match(page, /indices:\{title:"Индексы[^"]*",w:0,ctx:true,ref:true,/);
  assert.match(page, /if\(!BLOCKS\[bid\]\.ref\) blockScores\[/);
  assert.match(page, /try\{ paintIndices\(score,noData\); \}catch\(e\)\{/);
  assert.doesNotMatch(page, /addInd\(\{id:"indices"/, "таблица — не карточка IND");
});

/* ---- тренд: от максимума и к 200-дневной ---- */

const day0 = Date.UTC(2025, 0, 2);
const ser = (vals) => vals.map((v, i) => ({ d: new Date(day0 + i * 864e5), v }));

test("от 52-нед. максимума и к 200-дневной", () => {
  const vals = Array.from({ length: 300 }, (_, i) => (i < 260 ? 100 + i * 0.1 : 125.9 - (i - 259) * 0.5));
  const s = ser(vals);
  const st = trendOf(s);
  const px = vals[299], hi = Math.max(...vals.slice(-252)), sma = vals.slice(-200).reduce((a, v) => a + v, 0) / 200;
  assert.ok(Math.abs(st.fromHi - (px / hi - 1) * 100) < 1e-9);
  assert.ok(Math.abs(st.to200 - (px / sma - 1) * 100) < 1e-9);
  assert.equal(st.d.getTime(), s[299].d.getTime());
  const at = trendOf(s, s[259].d.toISOString().slice(0, 10));
  assert.equal(at.d.getTime(), s[259].d.getTime(), "дата среза: бары после неё не берутся");
  assert.ok(Math.abs(at.fromHi) < 1e-12, "на пике — 0 от максимума");
});

test("короткий ряд: <200 — нет данных, 200–251 — нет максимума", () => {
  assert.equal(trendOf(ser(Array(199).fill(10))), null);
  const st = trendOf(ser(Array(230).fill(10)));
  assert.equal(st.fromHi, null);
  assert.equal(st.to200, 0);
  assert.equal(trendOf(null), null);
  assert.equal(trendOf(ser([...Array(260).fill(10), 0, -1])).d.getTime(), day0 + 259 * 864e5, "нулевые цены отбрасываются");
});

/* ---- узкий рынок ---- */

test("узкий рынок: S&P в пределах 2% от максимума И Russell ниже 200-дневной", () => {
  assert.equal(narrowOf({ fromHi: -1.8, to200: 5 }, { fromHi: -9.2, to200: -0.5 }), true);
  assert.equal(narrowOf({ fromHi: -2, to200: 5 }, { fromHi: -9, to200: -0.01 }), true, "ровно −2% — ещё у максимума");
  assert.equal(narrowOf({ fromHi: -2.01, to200: 5 }, { fromHi: -9, to200: -0.5 }), false, "S&P дальше 2% от максимума");
  assert.equal(narrowOf({ fromHi: 0, to200: 5 }, { fromHi: -3, to200: 0 }), false, "Russell на 200-дневной — не ниже");
  assert.equal(narrowOf({ fromHi: 0, to200: 5 }, { fromHi: -3, to200: 1.2 }), false, "широкий максимум");
  assert.equal(narrowOf(null, { to200: -1 }), null, "нет S&P — отметки нет");
  assert.equal(narrowOf({ fromHi: null, to200: 1 }, { to200: -1 }), null, "нет максимума S&P — отметки нет");
  assert.equal(narrowOf({ fromHi: -1, to200: 1 }, null), null, "нет Russell — отметки нет");
});

/* ---- сборщик: ключи yix:* ---- */

const ts0 = Date.UTC(2025, 6, 1, 13, 30) / 1000;
const rows = (n, f = (i) => [ts0 + i * 86400, 100 + i / 10, 99 + i / 10]) => Array.from({ length: n }, (_, i) => f(i));

test("сборщик: yix — ≥260 строк [ts, close, adjclose] с положительными числами", () => {
  assert.equal(valid("yix:IWM", rows(300)), true);
  assert.equal(valid("yix:DIA", rows(260)), true);
  assert.equal(valid("yix:QQQ", rows(259)), false, "меньше 260 сессий");
  assert.equal(valid("yix:RSP", [...rows(299), [ts0, 0, 1]]), false, "нулевое закрытие");
  assert.equal(valid("yix:RSP", [...rows(299), [ts0, 100]]), false, "строка не из трёх полей");
  assert.equal(valid("yix:RSP", [...rows(299), [0, 100, 99]]), false, "нет времени бара");
  assert.equal(valid("yix:IWM", "Date,Close\n2026-10-27,250"), false, "строка — не форма yix");
  assert.equal(valid("yix:IWM", { chart: {} }), false);
  assert.equal(valid("yix:IWM", null), false);
});

test("сборщик: соседние ключи проверяются как прежде", () => {
  assert.equal(valid("stq:^vix", "Symbol,Date,Time,Open,High,Low,Close,Volume\n^VIX,2026-10-27,00:00:00,15,15,15,15,0"), true, "строка stq не отсечена «не объект»");
  const cboe = "DATE,OPEN,HIGH,LOW,CLOSE\n" + Array.from({ length: 300 }, () => "10/27/2026,10,10,10,10").join("\n");
  assert.equal(valid("cboe:cor1m", cboe), true, "строка CBOE не отсечена «не объект»");
  assert.equal(valid("ypx:SPY", rows(150)), true);
  assert.equal(valid("ypx:SPY", rows(149)), false);
  assert.equal(valid("fred:SP500", { observations: [1, 2, 3, 4] }), true);
});

test("сборщик: фонды DIA, QQQ, IWM, RSP под ключами yix, подложка — 3 сут.", () => {
  assert.match(collector, /for\(const s of \["DIA","QQQ","IWM","RSP"\]\)\{[\s\S]{0,120}put\("yix:"\+s,/);
  assert.match(collector, /\(k\.startsWith\("ypx:"\)\|\|k\.startsWith\("yix:"\)\)\?3\*86400e3:/);
  assert.doesNotMatch(collector, /"(\^GSPC|\^DJI|\^NDX|\^RUT|\^SPXEW)"/, "котировки самих индексов в публичный снимок не идут");
});

test("текущий снимок: ключи yix, если уже есть, проходят valid()", () => {
  let snap = null;
  try { snap = JSON.parse(readFileSync("docs/snapshot.json", "utf-8")); } catch { /* снимка в рабочей копии может не быть */ }
  const keys = Object.keys(snap?.responses || {}).filter((k) => k.startsWith("yix:"));
  for (const k of keys) assert.equal(valid(k, snap.responses[k]), true, k);
  console.log(`      (в снимке ключей yix: ${keys.length})`);
});

console.log(`тестов пройдено: ${passed}, провалов: ${failures}`);
if (failures) process.exit(1);
