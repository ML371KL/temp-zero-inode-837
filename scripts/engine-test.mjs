// Регрессионный тест движка панели: страница исполняется в настоящем Chrome на текущем снимке.
//
// Движок живёт в браузере (docs/index.html), и Node-тест логики без браузера проверял бы копию, а не
// оригинал. Поэтому страница поднимается целиком (свой статический сервер, Chrome из CHROME_PATH) и
// проверяется то, что видит пользователь и что читают уведомления и сервер ступени:
//   1) страница досчитывается без ошибок JS;
//   2) решение state.decision внутренне согласовано (доля ∈ {0, 50, 100}, режим ↔ ступень, риск
//      просадки в (0, 1), действие и границы на месте, общий балл = агрегация карточек + детекторы);
//   3) машина ступеней в режиме писателя: кандидат ждёт следующей торговой сессии, шаг — одна
//      ступень, откат внутри гистерезиса снимает кандидата, долгий перерыв не «протухает» сигнал,
//      память браузера в режиме писателя не трогается.
// Запуск: CHROME_PATH=/path/to/chrome node scripts/engine-test.mjs  (нужен puppeteer-core).
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DIR = process.env.ENGINE_TEST_DIR || "docs";
const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error("нужен CHROME_PATH"); process.exit(2); }
let puppeteer;
try { puppeteer = require("puppeteer-core"); }
catch { puppeteer = require(join(process.env.PUPPETEER_DIR || "", "node_modules/puppeteer-core")); }

const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const file = join(DIR, path === "/" ? "index.html" : path);
  if (!file.startsWith(DIR) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const URL = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let failures = 0;
const test = async (name, fn) => {
  try { await fn(); console.log("ok  ", name); }
  catch (e) { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); }
};

async function open(writerMemory) {
  /* у каждого прогона свой чистый контекст: иначе память ступени, записанная страницей-читателем,
     видна странице-писателю того же origin */
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));
  if (writerMemory !== undefined)
    await page.evaluateOnNewDocument(m => { window.__RUNG_WRITER = { memory: m }; }, writerMemory);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof state !== "undefined" && state.settled === true, { timeout: 150000 });
  return { page, errors };
}

try {
  const { page, errors } = await open();
  await test("страница досчитывается без ошибок JS", async () => {
    assert.deepEqual(errors, []);
  });
  const d = await page.evaluate(() => state.decision);
  await test("решение на месте и согласовано", async () => {
    assert.equal(d.v, 5);
    assert.equal(d.settled, true);
    assert.ok([0, 50, 100].includes(d.pct), "доля " + d.pct);
    assert.ok(["low", "moderate", "elevated", "crisis", "nodata"].includes(d.regime));
    if (!d.noData && d.pend == null && !d.override) {
      const byRung = { 0: ["crisis"], 1: ["elevated"], 2: ["low", "moderate"] };
      assert.ok(byRung[d.rung].includes(d.regime), `режим ${d.regime} при ступени ${d.rung} без кандидата`);
    }
    assert.ok(d.tail == null || (d.tail.p > 0 && d.tail.p < 1), "риск просадки вне (0, 1)");
    assert.ok(typeof d.action === "string" && d.action.length > 10, "нет текста действия");
    assert.match(d.dataAsOf, /^\d{4}-\d{2}-\d{2}$/);
    if (d.rung === 2 && !d.noData && !d.override) assert.equal(d.triggers.down.composite, -13);
  });
  await test("общий балл = агрегация карточек + детекторы", async () => {
    const r = await page.evaluate(() => ({ agg: aggregate({}).composite, det: state.detPts, comp: state.decision.composite }));
    assert.ok(Math.abs(Math.max(-100, Math.min(100, r.agg + r.det)) - r.comp) < 0.01, JSON.stringify(r));
  });
  await test("на экране нет прежних противоречивых указаний", async () => {
    const t = await page.evaluate(() => document.getElementById("verdictBox").innerText);
    assert.ok(!/Сигнал сокращать/.test(t), "статичный «сигнал сокращать» вернулся");
    assert.ok(!/ПОКУПАТЬ|ДОКУПАТЬ ВЫБОРОЧНО/.test(t), "глагольные вердикты вернулись");
  });
  await page.close();

  // машина ступеней: режим писателя, балл двигается подменой зон, сессии — новыми датами рыночных рядов
  const w = await open({ v: 2, rung: 2, since: "2026-01-02", pend: null, pendSession: null });
  await w.page.evaluate(() => {
    window.__orig = Object.fromEntries(Object.entries(state.data).map(([k, v]) => [k, v ? v.zi : null]));
    window.force = target => {
      for (const i of IND) { const r = state.data[i.id]; if (r && __orig[i.id] != null) r.zi = __orig[i.id]; }
      const cards = IND.filter(i => !i.info && state.data[i.id] && state.data[i.id].zi != null);
      for (let it = 0; it < 300; it++) {
        const c = aggregate({}).composite + state.detPts; if (Math.abs(c - target) < 2) return;
        const dir = c > target ? -1 : 1; let moved = false;
        for (const i of cards) { const r = state.data[i.id]; const s0 = i.zones[r.zi].s;
          const cand = i.zones.map((z, k) => ({ k, s: z.s })).filter(z => dir < 0 ? z.s < s0 : z.s > s0)
            .sort((a, b) => dir < 0 ? b.s - a.s : a.s - b.s)[0];
          if (cand) { r.zi = cand.k; moved = true; if (Math.abs(aggregate({}).composite + state.detPts - target) < 2) return; } }
        if (!moved) return;
      }
    };
    let day = new Date(state.decision.dataAsOf + "T00:00:00Z");
    window.nextSession = () => { day = new Date(day.getTime() + 864e5);
      for (const k of ["SP500", "VIXCLS", "BAMLH0A0HYM2"]) { const s = FREDCACHE[k].obs; s.push({ d: new Date(day), v: s[s.length - 1].v }); } };
    window.run = target => { force(target); compute(); const d = state.decision; window.__RUNG_WRITER.memory = d.memory;
      return { c: d.composite, rung: d.rung, pend: d.pend, src: d.source }; };
  });
  const S = (fn, ...a) => w.page.evaluate(fn, ...a);
  await test("режим писателя", async () => assert.equal((await S(() => run(20))).src, "writer"));
  await test("кандидат ждёт следующей сессии", async () => {
    const a = await S(() => run(-20)); assert.equal(a.rung, 2); assert.equal(a.pend, 1);
    const b = await S(() => run(-20)); assert.equal(b.rung, 2, "в ту же сессию доля не меняется");
    await S(() => nextSession());
    const c = await S(() => run(-20)); assert.equal(c.rung, 1, "на следующей сессии — 50%");
  });
  await test("шаг — одна ступень за сессию", async () => {
    const a = await S(() => run(-50)); assert.equal(a.rung, 1); assert.equal(a.pend, 0);
    await S(() => nextSession());
    const b = await S(() => run(-50)); assert.equal(b.rung, 0);
  });
  await test("гистерезис: кандидат на 50% — только при балле ниже −13", async () => {
    /* свойство, а не точка: подбор зон попадает в цель с точностью ±2, поэтому проверяется правило
       «кандидат ⇔ балл < −13» на фактически получившемся балле */
    await S(() => { window.__RUNG_WRITER.memory = { v: 2, rung: 2, since: "2026-01-02", pend: null, pendSession: null }; });
    for (const t of [-6, -9, -11, -12, -13, -14, -16]) {
      await S(() => { window.__RUNG_WRITER.memory = { v: 2, rung: 2, since: "2026-01-02", pend: null, pendSession: null }; });
      const a = await S(x => run(x), t);
      assert.equal(a.rung, 2);
      assert.equal(a.pend, a.c < -13 ? 1 : null, `балл ${a.c}: кандидат ${a.pend}`);
    }
  });
  await test("долгий перерыв не «протухает» сигнал", async () => {
    for (let k = 0; k < 9; k++) await S(() => nextSession());
    const a = await S(() => run(-20)); assert.equal(a.rung, 1);
  });
  await test("в режиме писателя память браузера не трогается", async () => {
    assert.equal(await S(() => localStorage.getItem("razlom26.rung.v2")), null);
  });
  await test("сценарии без ошибок JS", async () => assert.deepEqual(w.errors, []));
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.error(`\nпровалено: ${failures}`); process.exit(1); }
console.log("\nдвижок: все проверки пройдены");
