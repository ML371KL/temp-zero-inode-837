// Тест поправки владельца (v5.5). Без сети и без браузера: ядро ⟦OWNER-CORE⟧ исполняется прямо из docs/index.html.
// Проверяется: форма docs/owner.json (cap только 0 или 50, даты, срок), действующая доля = min(модель, cap),
// разница с моделью по закрытиям дневника, файл в репозитории выключен.
// Запуск: node scripts/owner-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let failures = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("ok  ", name); }
  catch (e) { failures++; console.log("FAIL", name, "\n     ", e && e.message || e); }
};
const page = readFileSync("docs/index.html", "utf-8").replace(/\r\n/g, "\n");
const m = page.match(/\/\* ⟦OWNER-CORE⟧ \*\/\n([\s\S]*?)\n\/\* ⟦\/OWNER-CORE⟧ \*\//);
if (!m) { console.error("в docs/index.html нет блока ⟦OWNER-CORE⟧"); process.exit(1); }
const { ownerOf, ownerEff, ownerDelta } = new Function(m[1] + "\nreturn {ownerOf,ownerEff,ownerDelta};")();
const PCT = [0, 50, 100];
const ON = { cap: 50, since: "2026-11-02", until: "2026-11-20", reason: "  отчёты гиперскейлеров  " };

test("файл в репозитории выключен: {\"cap\":null}", () => {
  const cfg = JSON.parse(readFileSync("docs/owner.json", "utf-8"));
  assert.deepEqual(cfg, { cap: null });
  assert.equal(ownerOf(cfg, "2026-11-05"), null);
});

test("включённая форма: cap только 0 или 50, даты обязательны, until не раньше since", () => {
  assert.deepEqual(ownerOf(ON, "2026-11-05"), { cap: 50, since: "2026-11-02", until: "2026-11-20", reason: "отчёты гиперскейлеров" });
  assert.equal(ownerOf({ ...ON, cap: 0 }, "2026-11-05").cap, 0);
  for (const bad of [null, {}, { cap: 30, since: ON.since, until: ON.until }, { cap: "50", since: ON.since, until: ON.until }, { cap: 100, since: ON.since, until: ON.until },
    { cap: 50, until: ON.until }, { cap: 50, since: "2.11.2026", until: ON.until }, { cap: 50, since: "2026-11-20", until: "2026-11-02" }])
    assert.equal(ownerOf(bad, "2026-11-05"), null, JSON.stringify(bad));
});

test("срок: до since и после until поправки нет — истёкшая выключается сама", () => {
  assert.equal(ownerOf(ON, "2026-11-01"), null);
  assert.ok(ownerOf(ON, "2026-11-02") && ownerOf(ON, "2026-11-20"), "границы включительно");
  assert.equal(ownerOf(ON, "2026-11-21"), null);
  assert.equal(ownerOf(ON, ""), null);
});

test("действующая доля = min(модель, поправка)", () => {
  const own = ownerOf(ON, "2026-11-05");
  assert.deepEqual([100, 50, 0].map((p) => ownerEff(p, own)), [50, 50, 0]);
  assert.deepEqual([100, 50, 0].map((p) => ownerEff(p, ownerOf({ ...ON, cap: 0 }, "2026-11-05"))), [0, 0, 0]);
  assert.equal(ownerEff(100, null), 100, "выключена — доля модели");
  assert.equal(ownerEff(null, own), null);
});

test("±X п.п. к модели по закрытиям дневника: доля на закрытии работает на ход к следующей сессии", () => {
  const own = ownerOf(ON, "2026-11-10");
  const diary = [
    { d: "2026-10-30", r: 2, spx: 9000 },                     // до since — не в счёт
    { d: "2026-11-02", r: 2, spx: 7000 }, { d: "2026-11-03", r: 2, spx: 7070 },
    { d: "2026-11-04", r: 2, spx: 7140.7 }, { d: "2026-11-05", r: 1, spx: 7212.107 }, { d: "2026-11-06", r: 1, spx: 7000 }];
  const R = [7070 / 7000 - 1, 7140.7 / 7070 - 1, 7212.107 / 7140.7 - 1, 7000 / 7212.107 - 1], p = [1, 1, 1, 0.5], q = [0.5, 0.5, 0.5, 0.5];
  const model = R.reduce((a, r, i) => a * (1 + p[i] * r), 1), eff = R.reduce((a, r, i) => a * (1 + q[i] * r), 1);
  assert.ok(Math.abs(ownerDelta(diary, own, PCT) - (eff - model) * 100) < 1e-9, String(ownerDelta(diary, own, PCT)));
  assert.ok(ownerDelta(diary, own, PCT) < 0, "рынок рос, пока модель держала 100%, — поправка отстаёт");
  assert.equal(ownerDelta([{ d: "2026-11-02", r: 1, spx: 7000 }, { d: "2026-11-03", r: 1, spx: 7500 }], own, PCT), 0, "модель не выше поправки — разницы нет");
  assert.equal(ownerDelta([], own, PCT), 0);
  const zero = ownerOf({ ...ON, cap: 0 }, "2026-11-10");
  assert.ok(Math.abs(ownerDelta([{ d: "2026-11-02", r: 2, spx: 100 }, { d: "2026-11-03", r: 2, spx: 90 }], zero, PCT) - 10) < 1e-9, "cap 0 при падении на 10% — +10 п.п.");
});

console.log(`\nпоправка владельца: ${passed} пройдено, ${failures} провалено`);
process.exit(failures ? 1 : 0);
