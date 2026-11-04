// Тест правила «всплеск покупок инсайдеров» (v5.6). Без сети и без браузера: ядро ⟦INSIDER-CORE⟧ исполняется прямо из
// docs/index.html, сжатие breadth, валидатор формы и условный запрос — настоящими функциями из scripts/fetch-snapshot.mjs
// (урок v4.15: проверка копией условия пропустила битую форму, и прод упал).
// Проверяется: выключатель в репозитории выключен и выключенное правило не действует ни в одну дату; окна вокруг эпизодов
// 2008-12 и 2020-03…05 (граничные дни); неполный месяц (p:1) правило не включает; поправка владельца и аварийный рубильник
// старше правила; разница с моделью по дневнику; форма breadth в сборщике (сжатие, valid, ETag/304, сбой — прежнее).
// Запуск: node scripts/insider-surge-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let failures = 0, passed = 0;
const test = (name, fn) => {
  const run = async () => { await fn(); };
  return run().then(() => { passed++; console.log("ok  ", name); })
    .catch((e) => { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); });
};
const page = readFileSync("docs/index.html", "utf-8").replace(/\r\n/g, "\n");
const collector = readFileSync("scripts/fetch-snapshot.mjs", "utf-8").replace(/\r\n/g, "\n");
const m = page.match(/\/\* ⟦INSIDER-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/INSIDER-CORE⟧ \*\//);
if (!m) { console.error("в docs/index.html нет блока ⟦INSIDER-CORE⟧"); process.exit(1); }
const { insiderHist, insiderOf, insiderShares, insiderDelta, insWindows, insMonthAdd, insLastDay, INS_Z, INS_SHARE, INS_SPAN } =
  new Function(m[1] + "\nreturn {insiderHist,insiderOf,insiderShares,insiderDelta,insWindows,insMonthAdd,insLastDay,INS_Z,INS_SHARE,INS_SPAN};")();
const fnSrc = (re, what) => { const x = collector.match(re); if (!x) throw new Error("в сборщике нет " + what); return x[0]; };
const valid = new Function(fnSrc(/\nfunction valid\(key,j\)\{[\s\S]*?\n\}\n/, "function valid(key,j)") + "\nreturn valid;")();
const slimBreadth = new Function(fnSrc(/\nfunction slimBreadth\(j\)\{[\s\S]*?\n\}\n/, "function slimBreadth(j)") + "\nreturn slimBreadth;")();

const ON = { on: true };
const PCT = [0, 50, 100];

/* ряд z по месяцам 2005-01…2022-12: фон 0,3, всплески — по эпизодам ревизии 840 (04.11.2026), околопорог 1,99 — не всплеск */
const SURGE = { "2008-12": 2.6, "2015-08": 2.1, "2015-09": 2.8, "2015-10": 2.2, "2018-12": 2.3, "2019-01": 2.0, "2020-03": 3.1, "2020-04": 4.0, "2020-05": 2.4 };
const NEAR = { "2008-11": 1.99, "2016-02": 1.5 };
const series = (from, to, over) => {
  const out = [];
  for (let mm = from; mm <= to; mm = insMonthAdd(mm, 1)) out.push({ m: mm, z: over[mm] ?? 0.3 });
  return out;
};
const HIST = series("2005-01", "2022-12", { ...SURGE, ...NEAR });
const days = (from, to) => { const out = []; for (let t = Date.parse(from); t <= Date.parse(to); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const activeDays = (cfg, hist, from, to) => days(from, to).filter((d) => insiderOf(cfg, hist, d));
const ranges = (ds) => { // подряд идущие дни → «с … по …»
  const out = [];
  for (const d of ds) { const l = out[out.length - 1]; if (l && Date.parse(d) - Date.parse(l[1]) === 864e5) l[1] = d; else out.push([d, d]); }
  return out;
};

await test("выключатель в репозитории выключен: {\"on\": false}", () => {
  const raw = readFileSync("docs/insider-surge.json", "utf-8");
  assert.deepEqual(JSON.parse(raw), { on: false });
  assert.ok(/^\{"on": false\}\s*$/.test(raw), raw);
});

await test("константы правила: z ≥ 2, 100% нормы, 12 месяцев", () => {
  assert.deepEqual([INS_Z, INS_SHARE, INS_SPAN], [2, 100, 12]);
});

await test("выключенное правило не действует ни в один день 2005–2023 (выкл. = прежний вывод)", () => {
  for (const cfg of [null, undefined, {}, { on: false }, { on: "true" }, { on: 1 }, { on: "да" }, [], "on"])
    assert.deepEqual(activeDays(cfg, HIST, "2005-01-01", "2023-12-31"), [], JSON.stringify(cfg));
  assert.ok(activeDays(ON, HIST, "2005-01-01", "2023-12-31").length > 1000, "включённое действует");
});

await test("окно после всплеска 2008-12: с 2009-01-01 по 2009-12-31 включительно", () => {
  assert.equal(insiderOf(ON, HIST, "2008-12-31"), null, "в самом месяце всплеска правила ещё нет");
  const a = insiderOf(ON, HIST, "2009-01-01");
  assert.deepEqual(a, { share: 100, month: "2008-12", z: 2.6, since: "2009-01-01", until: "2009-12-31" });
  assert.ok(insiderOf(ON, HIST, "2009-06-15") && insiderOf(ON, HIST, "2009-12-31"), "12 месяцев включительно");
  assert.equal(insiderOf(ON, HIST, "2010-01-01"), null, "13-го месяца нет");
  assert.deepEqual(ranges(activeDays(ON, HIST, "2008-01-01", "2010-12-31")), [["2009-01-01", "2009-12-31"]]);
});

await test("окна вокруг 2020-03…05: склейка с 2020-04-01 по 2021-05-31, март-2020 в окно не входит", () => {
  assert.equal(insiderOf(ON, HIST, "2020-03-31"), null);
  assert.deepEqual(insiderOf(ON, HIST, "2020-04-01"), { share: 100, month: "2020-03", z: 3.1, since: "2020-04-01", until: "2021-05-31" });
  assert.equal(insiderOf(ON, HIST, "2020-05-10").month, "2020-04", "в окне называется последний месяц всплеска, чьё окно уже идёт");
  assert.equal(insiderOf(ON, HIST, "2020-06-01").month, "2020-05");
  assert.equal(insiderOf(ON, HIST, "2021-05-31").until, "2021-05-31");
  assert.equal(insiderOf(ON, HIST, "2021-06-01"), null);
  assert.deepEqual(ranges(activeDays(ON, HIST, "2020-02-01", "2021-12-31")), [["2020-04-01", "2021-05-31"]], "до 2020-01-31 тянется окно 2018-12…2019-01");
});

await test("прочие эпизоды: 2015-08…10 → 2015-09-01…2016-10-31, 2018-12…2019-01 → 2019-01-01…2020-01-31; околопорог 1,99 не всплеск", () => {
  assert.deepEqual(ranges(activeDays(ON, HIST, "2015-01-01", "2017-12-31")), [["2015-09-01", "2016-10-31"]]);
  assert.deepEqual(ranges(activeDays(ON, HIST, "2018-06-01", "2020-03-31")), [["2019-01-01", "2020-01-31"]]);
  assert.equal(insiderOf(ON, HIST, "2008-12-15"), null, "2008-11 (z 1,99) окна не создаёт");
  assert.equal(insiderOf(ON, HIST, "2019-01-05") && insiderOf(ON, HIST, "2019-01-05").month, "2018-12", "z ровно 2,0 (2019-01) — всплеск, но окно 2018-12 уже идёт");
  assert.equal(HIST.find((x) => x.m === "2019-01").z, 2.0);
});

await test("все месяцы, где правило действует в 2005–2022, — ровно объединение окон эпизодов", () => {
  const months = [...new Set(activeDays(ON, HIST, "2005-01-01", "2022-12-31").map((d) => d.slice(0, 7)))];
  const want = [];
  for (const [a, b] of [["2009-01", "2009-12"], ["2015-09", "2016-10"], ["2019-01", "2020-01"], ["2020-04", "2021-05"]])
    for (let mm = a; mm <= b; mm = insMonthAdd(mm, 1)) want.push(mm);
  assert.deepEqual(months, want);
});

await test("смежные окна склеиваются, разорванные — нет", () => {
  const h = series("2010-01", "2013-12", { "2010-06": 2.5, "2011-06": 2.5, "2013-01": 3 });
  assert.deepEqual(insWindows(h), [{ since: "2010-07-01", until: "2012-06-30" }, { since: "2013-02-01", until: "2014-01-31" }], "m и m+12 дают сплошные 24 месяца");
  assert.equal(insiderOf(ON, h, "2012-07-01"), null);
  assert.equal(insiderOf(ON, h, "2013-01-31"), null, "самый месяц нового всплеска — ещё без правила");
});

await test("неполный месяц (p:1) правило не включает; полный — включает с 1-го числа следующего", () => {
  const base = series("2024-11", "2026-09", {});
  const partial = [...base, { m: "2026-10", z: 3.5, p: 1 }];
  assert.deepEqual(activeDays(ON, partial, "2026-10-01", "2027-12-31"), []);
  const done = [...base, { m: "2026-10", z: 3.5 }];
  assert.equal(insiderOf(ON, done, "2026-10-31"), null);
  assert.equal(insiderOf(ON, done, "2026-11-01").since, "2026-11-01");
  /* текущий неполный месяц с z ≥ 2 при полном предыдущем без всплеска: окна нет, пока месяц не закроется */
  const cur = [...base, { m: "2026-10", z: 0.64 }, { m: "2026-11", z: 2.4, p: 1 }];
  assert.equal(insiderOf(ON, cur, "2026-11-20"), null);
  assert.equal(insiderOf(ON, cur, "2026-12-05"), null);
  /* после закрытия месяца (p снят) окно начинается с 1 декабря, а не со дня появления данных */
  const closed = [...base, { m: "2026-10", z: 0.64 }, { m: "2026-11", z: 2.4 }];
  assert.equal(insiderOf(ON, closed, "2026-11-30"), null);
  assert.equal(insiderOf(ON, closed, "2026-12-01").month, "2026-11");
});

await test("пустые данные, дыры z, мусорная дата — правила нет", () => {
  assert.equal(insiderOf(ON, null, "2026-11-05"), null);
  assert.equal(insiderOf(ON, [], "2026-11-05"), null);
  assert.equal(insiderOf(ON, [{ m: "2026-10", z: null }], "2026-11-05"), null);
  for (const d of ["", "2026-11", "5.11.2026", null, undefined]) assert.equal(insiderOf(ON, HIST, d), null, String(d));
});

await test("история: сжатая форма снимка и целый stats.json принимаются одинаково, мусор отбрасывается, порядок — по месяцам", () => {
  const slim = { asOf: "2026-10", z: 0.64, surge: false, thr: 2, history: [{ m: "2026-10", z: 0.64 }, { m: "2026-09", z: null }, { m: "2026-11", z: 2.4, p: 1 }, { m: "bad", z: 9 }, null] };
  const raw = { built: "x", breadth: { ...slim, b: 1, b3: 2, mean: 3, sd: 4 } };
  const want = [{ m: "2026-09", z: null, p: 0 }, { m: "2026-10", z: 0.64, p: 0 }, { m: "2026-11", z: 2.4, p: 1 }];
  assert.deepEqual(insiderHist(slim), want);
  assert.deepEqual(insiderHist(raw), want);
  for (const bad of [null, undefined, {}, { history: "x" }, { breadth: null }, 5, "s", []]) assert.equal(insiderHist(bad), null, JSON.stringify(bad));
  assert.deepEqual(insiderHist({ history: [{ m: "2026-10", z: "2.5" }, { m: "2026-09", z: "" }, { m: "2026-08", z: "abc" }] }).map((x) => x.z), [null, null, 2.5]);
});

await test("доли: правило поднимает до 100% при любой ступени модели; выключенное — доля модели", () => {
  const ins = insiderOf(ON, HIST, "2009-03-01");
  for (const model of PCT) {
    assert.deepEqual(insiderShares(model, ins, null, false), { base: 100, eff: 100, lifting: model < 100, limiting: false }, "модель " + model);
    assert.deepEqual(insiderShares(model, null, null, false), { base: model, eff: model, lifting: false, limiting: false });
  }
  assert.deepEqual(insiderShares(null, ins, null, false), { base: null, eff: null, lifting: false, limiting: false });
});

await test("поправка владельца старше правила: итоговая = min(доля после правила, cap) для всех ступеней", () => {
  const ins = insiderOf(ON, HIST, "2009-03-01");
  for (const cap of [0, 50]) for (const model of PCT) {
    const s = insiderShares(model, ins, { cap }, false);
    assert.equal(s.base, 100);
    assert.equal(s.eff, cap, `cap ${cap}, модель ${model}`);
    assert.equal(s.limiting, true);
    /* без правила поправка работает как раньше: min(модель, cap) — ровно формула ⟦OWNER-CORE⟧ */
    assert.equal(insiderShares(model, null, { cap }, false).eff, Math.min(model, cap));
    assert.equal(insiderShares(model, null, { cap }, false).limiting, model > cap);
  }
});

await test("аварийный рубильник старше правила: пока он включён, правило долю не поднимает", () => {
  const ins = insiderOf(ON, HIST, "2009-03-01");
  assert.deepEqual(insiderShares(0, ins, null, true), { base: 0, eff: 0, lifting: false, limiting: false });
  assert.deepEqual(insiderShares(0, ins, { cap: 50 }, true), { base: 0, eff: 0, lifting: false, limiting: false });
});

await test("разница с моделью по закрытиям дневника: доля на закрытии работает на ход к следующей сессии", () => {
  const diary = [
    { d: "2008-12-30", r: 0, spx: 800 },                                // до окна — не в счёт
    { d: "2009-01-02", r: 0, spx: 900 }, { d: "2009-01-05", r: 0, spx: 990 }, { d: "2009-01-06", r: 1, spx: 1089 }, { d: "2009-01-07", r: 2, spx: 1000 }];
  const eff = (d, p) => { const i = insiderOf(ON, HIST, d); return i ? Math.max(p, i.share / 100) : p; };
  const R = [990 / 900 - 1, 1089 / 990 - 1, 1000 / 1089 - 1], pm = [0, 0, 0.5], pe = [1, 1, 1];
  const model = R.reduce((a, r, i) => a * (1 + pm[i] * r), 1), rule = R.reduce((a, r, i) => a * (1 + pe[i] * r), 1);
  const x = insiderDelta(diary, "2009-01-01", eff, PCT);
  assert.ok(Math.abs(x - (rule - model) * 100) < 1e-9, String(x));
  assert.ok(x > 0, "рынок рос, пока модель сидела в 0%/50%, — правило впереди");
  assert.equal(insiderDelta([], "2009-01-01", eff, PCT), 0);
  assert.equal(insiderDelta(diary, "2009-01-01", (d, p) => p, PCT), 0, "без правила разницы нет");
});

/* ── сборщик: форма breadth ── */
const RAW = (over = {}) => ({
  built: "2026-11-04T03:43:07Z",
  breadth: { asOf: "2026-10", b: 118, b3: 340, z: 0.64, mean: 331.2, sd: 14.1, surge: false, thr: 2,
    history: series("2021-11", "2026-10", { "2022-03": 2.31 }).map((x, i) => ({ m: x.m, b: 100 + i, b3: 300 + i, z: x.z })).concat([{ m: "2026-11", b: 12, b3: 250, z: 1.1, p: 1 }]),
    ...over },
});

await test("сборщик: breadth сжимается до asOf, z, surge, thr и истории [{m,z,p?}]", () => {
  const s = slimBreadth(RAW());
  assert.deepEqual(Object.keys(s), ["asOf", "z", "surge", "thr", "history"]);
  assert.deepEqual(s.history[0], { m: "2021-11", z: 0.3 });
  assert.deepEqual(s.history.at(-1), { m: "2026-11", z: 1.1, p: 1 });
  assert.equal(s.history.length, 61);
  assert.ok(!JSON.stringify(s).includes('"b3"') && !JSON.stringify(s).includes("mean"), "лишних полей нет");
  assert.ok(JSON.stringify(s).length < 3000, "компактно: " + JSON.stringify(s).length);
});

await test("сборщик: valid('insider:breadth') принимает годную форму и отклоняет битую", () => {
  const ok = slimBreadth(RAW());
  assert.equal(valid("insider:breadth", ok), true);
  assert.equal(valid("insider:breadth", { ...ok, z: null }), true, "z=null (нет 24 месяцев базы) допустим");
  const bad = {
    "нет breadth": slimBreadth({ built: "x" }), "строка": "x", "пустая история": { ...ok, history: [] },
    "короче 24 мес.": { ...ok, history: ok.history.slice(-23) }, "asOf не месяц": { ...ok, asOf: "2026-10-31" },
    "asOf вне истории": { ...ok, asOf: "2026-07", history: ok.history.filter((x) => x.m !== "2026-07") },
    "asOf — неполный месяц": { ...ok, asOf: "2026-11" }, "z строкой": { ...ok, z: "0.64" }, "z NaN": { ...ok, z: NaN },
    "surge не булево": { ...ok, surge: "false" }, "thr ≤ 0": { ...ok, thr: 0 }, "thr нет": { ...ok, thr: NaN },
    "месяцы вразнобой": { ...ok, history: [...ok.history.slice(0, 5).reverse(), ...ok.history.slice(5)] },
    "повтор месяца": { ...ok, history: [ok.history[0], ...ok.history] },
    "z в истории — мусор": { ...ok, history: ok.history.map((x, i) => (i === 7 ? { ...x, z: NaN } : x)) },
  };
  for (const [name, v] of Object.entries(bad)) assert.equal(v && valid("insider:breadth", v), v ? false : v, name);
  const garbage = slimBreadth(RAW({ z: "abc" }));
  assert.equal(valid("insider:breadth", garbage), false, "мусорный z → NaN → отказ, прежнее значение остаётся");
});

/* условный запрос: настоящая getInsider() сборщика с подменными fetch/late/sleep */
const getInsider = new Function("fetch", "late", "sleep", "valid", "slimBreadth", "INSIDER_URL", "AbortSignal",
  fnSrc(/\nasync function getInsider\(prev,etag\)\{[\s\S]*?\n\}\n/, "async function getInsider(prev,etag)") + "\nreturn getInsider;");
const resp = (status, body, etag) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => (k.toLowerCase() === "etag" ? etag ?? null : null) }, json: async () => body });
const make = (script) => {
  const calls = [];
  const fetchStub = async (url, opt) => { calls.push({ url, h: opt.headers }); const x = script.shift(); if (x instanceof Error) throw x; return x; };
  return { calls, run: (prev, etag) => getInsider(fetchStub, () => false, async () => {}, valid, slimBreadth, "https://example.test/stats.json", AbortSignal)(prev, etag) };
};

await test("ETag: без прошлой копии условия нет; 200 → сжатая копия и ETag ответа", async () => {
  const t = make([resp(200, RAW(), '"abc"')]);
  const o = await t.run(undefined, '"old"');
  assert.equal(t.calls.length, 1);
  assert.ok(!("If-None-Match" in t.calls[0].h), "прошлой копии нет — условие не шлём");
  assert.equal(o.etag, '"abc"');
  assert.equal(o.j.asOf, "2026-10");
});

await test("ETag: годная копия + ETag → If-None-Match; 304 отдаёт копию без перезаписи", async () => {
  const prev = slimBreadth(RAW());
  const t = make([resp(304, null, null)]);
  const o = await t.run(prev, '"abc"');
  assert.equal(t.calls[0].h["If-None-Match"], '"abc"');
  assert.equal(o.j, prev);
  assert.equal(o.etag, '"abc"');
});

await test("ETag: битая прошлая копия условия не получает; 304 без условия — сбой, а не «нет изменений»", async () => {
  const t = make([resp(304, null, null), resp(304, null, null), resp(304, null, null)]);
  await assert.rejects(() => t.run({ asOf: "x" }, '"abc"'), /304 без условного запроса/);
  assert.ok(t.calls.every((c) => !("If-None-Match" in c.h)));
});

await test("сбой: HTTP 500 повторяется, затем ошибка (прежнее значение подложит merge сборщика); «поля ещё нет» — без повторов", async () => {
  const t = make([resp(500), resp(502), resp(503)]);
  await assert.rejects(() => t.run(slimBreadth(RAW()), '"abc"'), /HTTP 503/);
  assert.equal(t.calls.length, 3);
  const u = make([resp(200, { built: "x" }, '"n"')]);
  await assert.rejects(() => u.run(undefined, ""), /нет поля breadth/);
  assert.equal(u.calls.length, 1, "повтор «нет поля» не лечит");
  const v = make([new Error("fetch failed"), resp(200, RAW(), '"e2"')]);
  assert.equal((await v.run(undefined, "")).etag, '"e2"', "сетевой сбой → повтор");
});

await test("сборщик: ключ insider: хранится 45 суток, ETag пишется в meta только при успехе", () => {
  assert.match(collector, /k\.startsWith\("insider:"\)\)\?45\*86400e3/);
  assert.match(collector, /meta:\{symbols:NEWS_SYMBOLS,[\s\S]*?\.\.\.\(insiderEtag\?\{insider_etag:insiderEtag\}:\{\}\)\}/);
  assert.match(collector, /if\(R\["insider:breadth"\]!==undefined&&insiderNew!==null\) insiderEtag=insiderNew;/);
});

await test("месяцы и календарь: конец окна — последний день месяца m+12 (в том числе в високосный год)", () => {
  assert.equal(insLastDay("2012-02"), "2012-02-29");
  assert.equal(insLastDay("2013-02"), "2013-02-28");
  assert.equal(insMonthAdd("2020-03", 12), "2021-03");
  assert.equal(insMonthAdd("2020-12", 1), "2021-01");
  assert.equal(insiderOf(ON, series("2010-01", "2012-12", { "2011-02": 2.5 }), "2012-02-29").until, "2012-02-29");
});

console.log(`\nвсплеск покупок инсайдеров: ${passed} пройдено, ${failures} провалено`);
process.exit(failures ? 1 : 0);
