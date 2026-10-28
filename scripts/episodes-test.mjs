// Тест журнала срабатываний детекторов (v5.4.1). Без сети и без браузера.
// Ядро ⟦EPISODES-CORE⟧ исполняется прямо из docs/index.html; строки дневника — синтетические, в форме,
// которую пишет уведомитель (x — семь символов в порядке fund·capex·bdc·oil·infl·pivot·turn).
// Запуск: node scripts/episodes-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let failures = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("ok  ", name); }
  catch (e) { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); }
};
const page = readFileSync("docs/index.html", "utf-8").replace(/\r\n/g, "\n");
const m = page.match(/\/\* ⟦EPISODES-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/EPISODES-CORE⟧ \*\//);
if (!m) { console.error("в docs/index.html нет блока ⟦EPISODES-CORE⟧"); process.exit(1); }
const { detEpisodes, DET_KEYS, DET_EP_SEEDS } = new Function(m[1] + "\nreturn {detEpisodes,DET_KEYS,DET_EP_SEEDS};")();

// сессии: рабочие дни с 1.12.2026, S&P растёт на 0,1% в день
const days = []; for (let t = Date.UTC(2026, 11, 1); days.length < 120; t += 864e5) { const d = new Date(t); if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10)); }
const row = (i, x, extra = {}) => ({ d: days[i], c: 10, l: 0, r: 2, g: "moderate", spx: +(7000 * 1.001 ** i).toFixed(2), x, ...extra });
const X = (o = {}) => DET_KEYS.map((k) => o[k] || ".").join("");

test("порядок детекторов совпадает с уведомителем", () => {
  const n = readFileSync("scripts/notify.mjs", "utf-8").match(/const DIARY_DETS = (\[[^\]]+\]);/);
  assert.ok(n, "в уведомителе нет DIARY_DETS");
  assert.deepEqual(JSON.parse(n[1]), DET_KEYS);
});

test("эпизод — подряд идущие сессии НАБЛЮДЕНИЕ/СРАБОТАЛ; пик — худшее состояние", () => {
  const D = days.slice(0, 100).map((_, i) => row(i, i >= 5 && i <= 9 ? X({ capex: i === 7 ? "F" : "w" }) : X(), i >= 5 && i <= 9 ? { xc: i < 7 ? "META/cut" : "META/cut,GOOGL/dc" } : {}));
  const E = detEpisodes(D, [], 10);
  assert.equal(E.length, 1);
  assert.deepEqual([E[0].det, E[0].from, E[0].to, E[0].peak, E[0].last], ["capex", days[5], days[9], "fired", false]);
  assert.deepEqual(E[0].co, ["META/cut", "GOOGL/dc"], "компании — объединение за эпизод");
  assert.ok(Math.abs(E[0].r21 - (D[26].spx / D[5].spx - 1) * 100) < 1e-9 && Math.abs(E[0].r63 - (D[68].spx / D[5].spx - 1) * 100) < 1e-9, "S&P +21/+63 по закрытиям дневника");
});

test("пока сессий не набралось — пусто; эпизод на последней записи помечен как идущий", () => {
  const D = days.slice(0, 30).map((_, i) => row(i, i >= 20 ? X({ oil: "w" }) : X()));
  const E = detEpisodes(D, [], 10);
  assert.equal(E.length, 1);
  assert.equal(E[0].last, true);
  assert.equal(E[0].r21, null);
  assert.equal(E[0].r63, null);
});

test("разрыв и строки без поля x закрывают эпизод; позитивное «+» эпизодом не считается", () => {
  const D = days.slice(0, 20).map((_, i) => (i === 4 ? { ...row(i, X()), x: undefined } : row(i, i < 8 ? X({ fund: i === 4 ? "." : "F", turn: "+" }) : X())));
  const E = detEpisodes(D, [], 10).filter((e) => e.det === "fund");
  assert.deepEqual(E.map((e) => [e.from, e.to]), [[days[5], days[7]], [days[0], days[3]]]);
  assert.ok(!detEpisodes(D, [], 10).some((e) => e.det === "turn"));
});

test("последние 10, новые сверху; несколько детекторов одновременно — отдельные эпизоды", () => {
  const D = days.slice(0, 80).map((_, i) => row(i, i % 6 === 0 ? X({ bdc: "w", oil: "F" }) : X()));
  const E = detEpisodes(D, [], 10);
  assert.equal(E.length, 10);
  assert.ok(E.every((e, k) => !k || E[k - 1].from >= e.from), "по убыванию начала");
  assert.equal(E.filter((e) => e.from === E[0].from).length, 2);
});

test("восстановленный эпизод капекса октября: из DET_EP_SEEDS, S&P — по закрытиям дневника", () => {
  assert.deepEqual(DET_EP_SEEDS.map((s) => [s.det, s.from, s.to, s.peak]), [["capex", "2026-10-02", "2026-10-27", "fired"]]);
  assert.deepEqual(DET_EP_SEEDS[0].co.map((c) => c.split("/")[0]), ["ORCL", "GOOGL", "MSFT", "AMZN"]);
  const oct = []; for (let t = Date.UTC(2026, 9, 1); oct.length < 70; t += 864e5) { const d = new Date(t); if (d.getUTCDay() % 6) oct.push({ d: d.toISOString().slice(0, 10), spx: 7700 + oct.length }); }
  const E = detEpisodes(oct, DET_EP_SEEDS, 10);
  assert.equal(E.length, 1);
  assert.equal(E[0].seed, true);
  const i0 = oct.findIndex((r) => r.d === "2026-10-02");
  assert.ok(Math.abs(E[0].r21 - (oct[i0 + 21].spx / oct[i0].spx - 1) * 100) < 1e-9);
  assert.equal(E[0].r63, (oct[i0 + 63].spx / oct[i0].spx - 1) * 100);
  assert.equal(detEpisodes([], DET_EP_SEEDS, 10)[0].r21, null, "без дневника — пусто");
});

console.log(`\nэпизоды: ${passed} пройдено, ${failures} провалено`);
process.exit(failures ? 1 : 0);
