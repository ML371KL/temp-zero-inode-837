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
import { PAGE_EXTRACTOR } from "./notify.mjs";   /* v5.3: тот же текст, что уведомитель исполняет в Chrome */

const require = createRequire(import.meta.url);
const DIR = process.env.ENGINE_TEST_DIR || "docs";
const PAGE = readFileSync(join(DIR, "index.html"), "utf-8").replace(/\r\n/g, "\n");
const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error("нужен CHROME_PATH"); process.exit(2); }
let puppeteer;
try { puppeteer = require("puppeteer-core"); }
catch { puppeteer = require(join(process.env.PUPPETEER_DIR || "", "node_modules/puppeteer-core")); }

const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const file = join(DIR, path === "/" ? "index.html" : path);
  if (!file.startsWith(join(DIR)) || !existsSync(file)) { res.writeHead(404); res.end(); return; }  /* join: абсолютный путь Windows со слэшами */
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
  // Точные балл и опережающие (в решении они округлены до сотых): та же арифметика, что в compute().
  const exact = await page.evaluate(() => ({ score: Math.max(-100, Math.min(100, aggregate({}).composite + state.detPts)), lead: state.leadScore }));
  await test("решение на месте и согласовано", async () => {
    assert.equal(d.v, 5);
    assert.equal(d.settled, true);
    assert.ok([0, 50, 100].includes(d.pct), "доля " + d.pct);
    assert.ok(["low", "moderate", "elevated", "crisis", "nodata"].includes(d.regime));
    // v5.2.1: правило страницы — режим считается по СИГНАЛЬНОЙ ступени: сырая, если сдвиг к ней прошёл запас ±HYST,
    // иначе исполненная. Исполненная может отставать от сигнальной законно — при заморозке повышения или ожидании
    // подтверждения на следующей сессии; прежняя проверка «режим по исполненной ступени» ложно падала на настоящем
    // журнале прода (50% при «умеренном» из-за заморозки). Пороги — из страницы, само правило записано здесь заново.
    const m = PAGE.match(/const T1=(-?\d+), T2=(-?\d+), G=(-?\d+), HYST=(\d+), PCT=\[[^\]]*\], LOW=(\d+), LOWLEAD=(\d+);/);
    assert.ok(m, "на странице нет строки порогов лестницы");
    const [T1, T2, G, HYST, LOW, LOWLEAD] = m.slice(1).map(Number);
    const rungFrom = (c, l) => (c >= T1 ? 2 : c >= T2 ? 1 : l <= G ? 0 : 1);
    if (!d.noData) {
      const { score, lead } = exact, cur = d.rung;
      assert.equal(d.raw, d.override ? 0 : rungFrom(score, lead), "сырая ступень не по порогам");
      const passes = (d.raw > cur && rungFrom(score - HYST, lead - HYST) > cur) || (d.raw < cur && rungFrom(score + HYST, lead + HYST) < cur);
      const sig = d.override ? 0 : passes ? d.raw : cur;
      const want = sig === 0 ? "crisis" : sig === 1 ? "elevated" : score >= LOW && lead >= LOWLEAD ? "low" : "moderate";
      assert.equal(d.regime, want, `режим ${d.regime} при исполненной ступени ${cur}, сырой ${d.raw}, сигнальной ${sig}`);
      if (sig !== cur) assert.ok(d.pend != null || d.frozen || (d.freezeBy || []).length,
        `доля ${d.pct}% отстаёт от сигнальной ступени ${sig} без кандидата и без заморозки`);
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
  await test("блок «Индексы»: строка S&P совпадает с карточками, блок вне ИИ-разбора и покрытия", async () => {
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#card_indices tbody tr")].map(tr => [...tr.children].map(td => td.textContent));
      const snap = buildSnapshot();
      return { rows, vTail: document.getElementById("vTail").textContent, spxDelta: (state.data.spx || {}).delta || "",
        cover: state.decision.coverage, total: IND.filter(i => !i.optional && !i.info).length,
        ai: Object.keys(snap.block_scores).some(t => /^Индексы/.test(t)) || snap.indicators.some(i => /^Индексы/.test(i.block)),
        flagHidden: document.getElementById("idxFlag").hidden };
    });
    assert.deepEqual(r.rows.map(x => x[0]), ["S&P 500", "Dow Jones", "Nasdaq-100", "Russell 2000", "S&P равновзв."]);
    assert.equal(r.rows[0][3], r.vTail, "риск −10% строки S&P = карточка риска вердикта");
    const m = /^([+−-]?)(\d+,\d)%/.exec(r.spxDelta);
    if (m) assert.equal(r.rows[0][2].replace("−", "-"), (m[1] === "+" ? "+" : m[1] ? "-" : "") + m[2] + "%", "к 200-дн. строки S&P = карточка тренда");
    for (const row of r.rows) assert.ok(row.slice(1).every(c => c === "—" || /^[+−]?\d+(,\d)?%$/.test(c)), "формат чисел: " + row.join(" | "));
    assert.equal(r.cover.total, r.total, "блок не меняет покрытие");
    assert.equal(r.ai, false, "блок «Индексы» не должен попадать в ИИ-разбор");
  });
  await test("v5.3: «Домохозяйства и жильё» — балл, доля, режим и покрытие без карточки те же; ИИ видит, уведомитель нет", async () => {
    const r = await page.evaluate((EX) => {
      const ind = IND.find(i => i.id === "households");
      if (!ind) return { missing: true };
      const pick = () => { const d = state.decision;
        return JSON.stringify({ comp: d.composite, lead: d.lead, pct: d.pct, rung: d.rung, raw: d.raw, regime: d.regime, cover: d.coverage,
          agg: aggregate({}).composite, bd: state.breakdown && state.breakdown.total, tiles: state.tiles, badges: state.blockBadges }); };
      const withCard = pick(), k = IND.indexOf(ind), saved = state.data.households;
      IND.splice(k, 1); delete state.data.households; compute();
      const without = pick();
      IND.splice(k, 0, ind); state.data.households = saved; compute();
      const again = pick();
      /* ИИ-снимок и уведомитель — на загруженной карточке; если снимок ещё без рядов, подставляется её форма */
      const fake = { value: "48,1", delta: "перцентиль <1 с 1978 года", note: "", zi: 0, date: new Date(), series: [], rows: [] };
      state.data.households = saved || fake;
      const snap = buildSnapshot(), ext = new Function("return " + EX)();
      state.data.households = saved;
      const card = document.getElementById("card_households");
      return { info: ind.info, notify: ind.notify, block: ind.block, withCard, without, again, loaded: !!saved,
        ai: snap.indicators.find(i => i.name === ind.name) || null, ext: ext.indicators.map(i => i.id),
        rows: [...card.querySelectorAll(".hh-tab tbody tr")].map(tr => [...tr.children].map(td => td.textContent)),
        text: card.innerText, wide: getComputedStyle(card).gridColumnEnd };
    }, PAGE_EXTRACTOR);
    assert.ok(!r.missing, "карточки households нет в IND");
    assert.deepEqual([r.info, r.notify, r.block], [true, false, "context"]);
    assert.equal(r.without, r.withCard, "без карточки балл/доля/режим/покрытие другие");
    assert.equal(r.again, r.withCard, "повторный расчёт с карточкой разошёлся");
    assert.ok(r.ai && r.ai.type === "info" && /справочно/.test(r.ai.score) && /^Контекст/.test(r.ai.block), "в ИИ-снимке — как прочие карточки «Контекста»");
    assert.ok(!r.ext.includes("households"), "уведомитель не должен видеть карточку");
    if (r.loaded) {
      assert.equal(r.rows.length, 6, "шесть строк");
      for (const row of r.rows) assert.ok(row.length === 2 && row[1] === "нет данных" || row.length === 4, "строка: " + row.join(" | "));
      assert.ok(!/(^|[\s(])-\d/.test(r.text), "дефис перед числом на карточке");
    } else console.log("      (в снимке пока нет рядов карточки — проверены расчёт без неё, ИИ и уведомитель)");
  });
  await test("v5.4: новостные детекторы считают только отступления; заморозку дают только сработавшие", async () => {
    const r = await page.evaluate(() => {
      const last = id => (DETECTORS.find(d => d.id === id) || {}).last || {};
      const cap = last("d_capex"), Tc = newsTally(state.news.capex || []);
      return { st: cap.st, pts: cap.pts, inputs: cap.inputs || "", want: newsDet(Tc, "capex"), retreat: Tc.fN + Tc.uN,
        fric: Tc.fric, fired: state.detFired || {}, freezeBy: state.decision.freezeBy || [], newsAt: !!state.newsAt };
    });
    assert.ok(r.newsAt, "сканер новостей не отработал");
    assert.deepEqual([r.st, r.pts], [r.want.st, r.want.pts], "капекс считает не по правилу v5.4");
    if (!r.retreat) assert.deepEqual([r.st, r.pts], ["calm", 0], "без отступлений капекс СПОКОЙНО, 0");
    if (!r.fired.capex) assert.ok(!r.freezeBy.includes("Капекс"), "заморозка капексом без срабатывания");
    if (!r.fired.bdc) assert.ok(!r.freezeBy.includes("Стресс BDC"), "заморозка BDC без срабатывания");
    assert.match(r.inputs, /^отступление: фактов \d+/, "строка детектора начинается с отступлений");
    console.log("      капекс:", r.st, r.pts, "·", r.inputs.replace(/\s+/g, " ").slice(0, 160));
  });
  await test("полосы блоков: Σ пунктов + детекторы = общий балл, баллы блоков = плашкам разделов", async () => {
    const r = await page.evaluate(() => {
      const bd = state.breakdown, el = document.getElementById("blockBars");
      return { total: bd.total, blocksSum: bd.blocksSum, det: bd.det, detPts: state.detPts, agg: aggregate({}).composite, comp: state.decision.composite, tw: bd.tw,
        rows: bd.rows.map(x => ({ id: x.id, score: x.score, pts: x.pts, w: x.w, famPts: x.fams.reduce((a, f) => a + f.pts, 0), badge: document.getElementById("bs_" + x.id).textContent })),
        names: [...el.querySelectorAll(".ax > .n")].map(n => n.textContent), sum: el.querySelector(".bars-sum").textContent,
        shown: [...el.querySelectorAll(".ax > b.c")].map(b => b.textContent) };
    });
    assert.ok(Math.abs(r.blocksSum - r.agg) < 1e-9, `Σ блоков ${r.blocksSum} ≠ композит движка ${r.agg}`);
    assert.ok(Math.abs(r.det - r.detPts) < 1e-9, "детекторы ≠ state.detPts");
    assert.ok(Math.abs(Math.max(-100, Math.min(100, r.total)) - r.comp) < 0.006, `итог ${r.total} ≠ решение ${r.comp}`);
    for (const x of r.rows) {
      if (x.score == null) { assert.equal(x.badge, "нет данных"); continue; }
      assert.equal(Number(x.badge.replace("+", "").replace("−", "-")), Math.round(x.score) + 0, `${x.id}: плашка ${x.badge} ≠ балл ${x.score}`);
      assert.ok(Math.abs(x.pts - x.score * x.w / r.tw) < 1e-9 && Math.abs(x.famPts - x.pts) < 1e-9, x.id);
    }
    assert.deepEqual(r.names, ["Ликвидность", "Кредит", "Рынок", "Макро", "Режимы", "Детекторы"]);
    assert.match(r.sum, /^(Блоки [+−]?\d+,\d · детекторы [+−]?\d+,\d → общий балл [+−]?\d+,\d|Рубильник|Данных недостаточно)/);
    assert.ok(r.shown.every(s => s === "—" || /^[+−]?\d+,\d$/.test(s)), "числа полос: " + r.shown.join(" "));
  });
  await test("плитки и плашки: на экране «−», ИИ-снимок получает прежний вид из state", async () => {
    const r = await page.evaluate(() => {
      const ids = { score: "vScore", lead: "vLead", coin: "vCoin", det: "vDet" }, s = buildSnapshot();
      return { tiles: state.tiles, shown: Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, document.getElementById(id).textContent])),
        ai: { score: s.composite_score, lead: s.leading_score, coin: s.confirming_score, det: s.detectors_adjustment }, aiBlocks: s.block_scores,
        badges: Object.fromEntries(Object.keys(BLOCKS).filter(b => !BLOCKS[b].ref).map(b => [BLOCKS[b].title, [state.blockBadges[b], document.getElementById("bs_" + b).textContent]])),
        lead: state.leadScore, score: state.decision.composite };
    });
    for (const k of ["score", "lead", "coin", "det"]) {
      assert.match(r.tiles[k], /^[+-]?\d+(,\d)?$/, `state.tiles.${k} — прежний машинный вид`);
      assert.equal(r.shown[k], r.tiles[k].replace("-", "−"), `плитка ${k} на экране`);
      assert.equal(r.ai[k], r.tiles[k], `ИИ-снимок ${k}`);
    }
    for (const [t, [ascii, shown]] of Object.entries(r.badges)) { assert.equal(shown, ascii.replace("-", "−"), t); assert.equal(r.aiBlocks[t], ascii, "ИИ: " + t); }
    assert.ok(Math.abs(Number(r.tiles.lead.replace(",", ".")) - r.lead) <= 0.5, `плитка «куда клонится» ${r.tiles.lead} ≠ опережающие ${r.lead}`);
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
