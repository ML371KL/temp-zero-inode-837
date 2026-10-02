// Тесты уведомлений. Все фикстуры синтетические и НЕ зависят от текущей даты: проверяется
// поведение диффера, а не то, что сегодня опубликовал FRED.
import assert from "node:assert/strict";
import { diff, renderMessage, templateComment, fromSnapshotJSON, snapshotState, llmComments, sentKey, pruneSent, rememberRevised, appendTrend, appendChanges, significance, decisionChanges, thresholdFrom, humanRelease, releaseOf, pingMessage, HUMAN, MACRO_CADENCE,
  canonicalize, decisionStatus, allocationFromDecision, buildLedger, ledgerChanged, formatLedger, readLedger, closeOn, snapshotSpx, RUNG_PCT } from "./notify.mjs";

let passed = 0;
const test = (name, fn) => {
  try {
    const r = fn();
    if (r instanceof Promise) throw new Error("асинхронный тест должен идти через testAsync");
    passed++;
  } catch (e) {
    console.error(`ПРОВАЛ: ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
};
const asyncTests = [];
const testAsync = (name, fn) => asyncTests.push([name, fn]);

// Глушилка для синхронных вызовов: часть фикстур штатно печатает диагностику (отсев качков,
// алерты источников), и в логе CI она выглядела боевой тревогой.
const mute = (fn) => {
  const realLog = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
};

const ind = (o) => ({
  id: "x",
  name: "Показатель",
  value: "1",
  value_num: 1,
  unit: "",
  delta: "",
  zone: null,
  score: 0,
  observed_at: "2026-07-20",
  source: "FRED",
  note: "Заметка панели. Второе предложение.",
  voting: true,
  scheduled: true,
  revisable: false,
  release: "FRED",
  ...o,
});
const panelOf = (indicators, extra = {}) => ({
  generated_at: "2026-07-24T10:00:00.000Z",
  assetWord: "акций",
  verdict: { word: "ДЕРЖАТЬ", extra: "" },
  allocation: null,
  indicators,
  detectors: [],
  revisions: [],
  ...extra,
});
const stateOf = (panel) => snapshotState(panel);

test("первый прогон не рассылает историю", () => {
  const panel = panelOf([ind({})]);
  assert.equal(diff({}, panel).length, 0, "пустое состояние не должно порождать событий");
});

test("новая карточка не порождает событие задним числом", () => {
  const before = stateOf(panelOf([ind({ id: "a" })]));
  const after = panelOf([ind({ id: "a" }), ind({ id: "b", name: "Новая" })]);
  assert.equal(diff(before, after).length, 0);
});

test("релиз: дата сдвинулась и значение изменилось", () => {
  const before = stateOf(panelOf([ind({ value: "1", value_num: 1 })]));
  const after = panelOf([ind({ value: "2", value_num: 2, observed_at: "2026-07-21" })]);
  const ev = diff(before, after);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "release");
  assert.equal(ev[0].moves[0].before, "1");
  assert.equal(ev[0].moves[0].after, "2");
});

test("релиз без изменения значения молчит (пользователь просил «если значение меняется»)", () => {
  const before = stateOf(panelOf([ind({ value: "1", value_num: 1 })]));
  const after = panelOf([ind({ value: "1", value_num: 1, observed_at: "2026-07-21" })]);
  assert.equal(diff(before, after).length, 0);
});

test("одна публикация — одно сообщение на несколько карточек", () => {
  const before = stateOf(
    panelOf([
      ind({ id: "a", name: "A", value: "1", value_num: 1 }),
      ind({ id: "b", name: "B", value: "10", value_num: 10 }),
      ind({ id: "c", name: "C", value: "5", value_num: 5, release: "CBOE", source: "CBOE" }),
    ])
  );
  const after = panelOf([
    ind({ id: "a", name: "A", value: "2", value_num: 2, observed_at: "2026-07-21" }),
    ind({ id: "b", name: "B", value: "11", value_num: 11, observed_at: "2026-07-21" }),
    ind({ id: "c", name: "C", value: "6", value_num: 6, observed_at: "2026-07-21", release: "CBOE", source: "CBOE" }),
  ]);
  const ev = diff(before, after);
  assert.equal(ev.length, 2, "две разные публикации → два сообщения");
  const fred = ev.find((e) => e.title === "Данные ФРС");
  assert.ok(fred, `заголовок обязан быть человеческим именем источника, а не ключом датасета: ${ev.map((e) => e.title)}`);
  assert.equal(fred.moves.length, 2, "две карточки одной публикации живут в одном сообщении");
});

test("публикации с разной датой наблюдения не сливаются", () => {
  const before = stateOf(panelOf([ind({ id: "a", value: "1", value_num: 1 }), ind({ id: "b", value: "2", value_num: 2 })]));
  const after = panelOf([
    ind({ id: "a", value: "9", value_num: 9, observed_at: "2026-07-21" }),
    ind({ id: "b", value: "8", value_num: 8, observed_at: "2026-07-22" }),
  ]);
  assert.equal(diff(before, after).length, 2);
});

test("внутренняя переоценка показателя сама по себе не рассылается", () => {
  const before = stateOf(panelOf([ind({ zone: "норма", score: 1 })]));
  const after = panelOf([ind({ zone: "стресс", score: -1 })]);
  assert.equal(diff(before, after).length, 0, "смена зоны — кухня панели, читателю нужны данные и доля");
});

test("вышедшие данные рассылаются даже если оценка показателя сдвинулась", () => {
  const before = stateOf(panelOf([ind({ zone: "норма", score: 1, value: "1", value_num: 1 })]));
  const after = panelOf([ind({ zone: "стресс", score: -1, value: "2", value_num: 2, observed_at: "2026-07-21" })]);
  const ev = diff(before, after);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "release");
  assert.equal(ev[0].moves[0].after, "2");
});

test("непрерывный рыночный фид не порождает релизов", () => {
  const before = stateOf(panelOf([ind({ scheduled: false, value: "1", value_num: 1 })]));
  const after = panelOf([ind({ scheduled: false, value: "999", value_num: 999, observed_at: "2026-07-21" })]);
  assert.equal(diff(before, after).length, 0, "у котировок «значение изменилось» — не событие");
});

test("сдвиг оценки становится объяснением к смене доли, а не отдельным сообщением", () => {
  const alloc = (pct) => ({ pct, blocks: {}, bands: null, hold: null });
  const before = stateOf(panelOf([ind({ id: "hy", zone: "норма", score: 1 })], { allocation: alloc(85) }));
  const after = panelOf([ind({ id: "hy", zone: "стресс", score: -1 })], { allocation: alloc(65) });
  const ev = diff(before, after);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "allocation");
  assert.equal(ev[0].before, "85%");
  assert.equal(ev[0].after, "65%");
  assert.ok(ev[0].causes.some((c) => /спред высокодоходных/i.test(c)), `причина должна называть показатель человеческим именем: ${ev[0].causes}`);
});

test("ревизия: та же дата, другое значение", () => {
  const before = stateOf(panelOf([ind({ revisable: true, value: "100", value_num: 100 })]));
  const after = panelOf([ind({ revisable: true, value: "90", value_num: 90 })]);
  const ev = diff(before, after);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "revision");
});

test("непересматриваемый ряд ревизий не выдумывает", () => {
  const before = stateOf(panelOf([ind({ revisable: false, value: "100", value_num: 100 })]));
  const after = panelOf([ind({ revisable: false, value: "90", value_num: 90 })]);
  assert.equal(diff(before, after).length, 0);
});

test("дребезг чисел ниже машинной точности не считается изменением", () => {
  const before = stateOf(panelOf([ind({ revisable: true, value: "1", value_num: 1 })]));
  const after = panelOf([ind({ revisable: true, value: "1", value_num: 1 + 1e-15 })]);
  assert.equal(diff(before, after).length, 0);
});

test("смена доли — ОДНО сообщение, детектор внутри него объяснением", () => {
  const det = (state) => [{ id: "d1", name: "Слом маржинального спроса", state, inputs: "", note: "" }];
  const before = stateOf(panelOf([ind({})], { allocation: { pct: 80 }, detectors: det("calm") }));
  const after = panelOf([ind({})], { allocation: { pct: 5 }, detectors: det("fired") });
  const ev = diff(before, after);
  assert.equal(ev.length, 1, "вердикт и детектор не должны идти отдельными сообщениями");
  assert.equal(ev[0].kind, "allocation");
  assert.equal(ev[0].before, "80%");
  assert.ok(ev[0].causes.some((c) => c.includes("Приток денег в биткоин прекратился")), `детектор объясняется по-человечески: ${ev[0].causes}`);
});

test("сработавший сигнал риска без движения доли идёт отдельным коротким сообщением", () => {
  const det = (state) => [{ id: "d1", name: "Нефтяной шок / Ормуз", state, inputs: "WTI $96", note: "" }];
  const before = stateOf(panelOf([ind({})], { allocation: { pct: 65 }, detectors: det("calm") }));
  const ev = diff(before, panelOf([ind({})], { allocation: { pct: 65 }, detectors: det("fired") }));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "risk");
  assert.equal(ev[0].title, "Скачок цен на нефть");
});

test("снятие предварительной тревоги не шлётся", () => {
  const det = (state) => [{ id: "d1", name: "Нефтяной шок / Ормуз", state, inputs: "", note: "" }];
  const before = stateOf(panelOf([ind({})], { allocation: { pct: 65 }, detectors: det("watch") }));
  assert.equal(mute(() => diff(before, panelOf([ind({})], { allocation: { pct: 65 }, detectors: det("calm") }))).length, 0);
});

test("алерт источника без наблюдаемых изменений в рассылку не идёт", () => {
  const rev = [{ key: "network:2026-07-24:abc", text: "источник переписал уже отданные данные" }];
  const ev = mute(() => diff(stateOf(panelOf([ind({})])), panelOf([ind({})], { revisions: rev })));
  assert.equal(ev.length, 0, "«изменено строк: 1» без старого и нового значения — не сообщение");
});

/* ---- значимость движения: рутина дневных рядов не рассылается ---- */

// ряд с ровным шагом 1 и одним крупным выбросом в конце — задаётся явно, дат «от сегодня» нет
const seriesPoints = (steps, startDay = "2026-01-01") => {
  const t0 = Date.parse(startDay + "T00:00:00Z");
  const pts = {};
  let v = 100;
  steps.forEach((d, k) => { v += d; pts[t0 + k * 864e5] = v; });
  return pts;
};
const flat = Array.from({ length: 30 }, (_, k) => (k % 2 ? 1 : -1)); // обычный дрейф ±1

test("мелкое движение официальных данных ВСЁ РАВНО рассылается", () => {
  // Правило владельца: всё, что публикуется по календарю, приходит сразу. Фильтр «значимости»
  // здесь был и за сутки съел SOFR−IORB, HY-спред, VIX и разворот юаня — сторож против возврата.
  const pts = seriesPoints([...flat, 0.2]);
  const before = stateOf(panelOf([ind({ value: "1", value_num: 1, points: seriesPoints(flat) })]));
  const after = panelOf([ind({ value: "1.2", value_num: 1.2, observed_at: "2026-07-21", points: pts })]);
  assert.equal(diff(before, after).length, 1, "данные с календарём публикации молчать не должны");
});

test("крупное движение дневного ряда рассылается и помечается", () => {
  const pts = seriesPoints([...flat, 12]);
  const before = stateOf(panelOf([ind({ value: "1", value_num: 1, points: seriesPoints(flat) })]));
  const after = panelOf([ind({ value: "13", value_num: 13, observed_at: "2026-07-21", points: pts })]);
  const ev = diff(before, after);
  assert.equal(ev.length, 1);
  assert.match(ev[0].moves[0].delta, /движение/, "заметное движение обязано быть помечено прямо в тексте");
});

test("недельные и более редкие публикации проходят ВСЕГДА, даже мелким шагом", () => {
  const weekly = {};
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  Array.from({ length: 30 }, (_, k) => (weekly[t0 + k * 7 * 864e5] = 100 + (k % 2 ? 1 : -1)));
  const later = { ...weekly, [t0 + 30 * 7 * 864e5]: 100.2 };
  const before = stateOf(panelOf([ind({ value: "100", value_num: 100, points: weekly })]));
  const ev = diff(before, panelOf([ind({ value: "100.2", value_num: 100.2, observed_at: "2026-07-21", points: later })]));
  assert.equal(ev.length, 1, "у недельного релиза сам факт выхода данных — событие");
});

test("смена знака помечается: приток стал оттоком", () => {
  const base = seriesPoints(flat);
  const before = stateOf(panelOf([ind({ value: "+34 млн $", value_num: 34, points: base })]));
  const after = panelOf([ind({ value: "-205 млн $", value_num: -205, observed_at: "2026-07-21", points: seriesPoints([...flat, 0.1]) })]);
  const ev = diff(before, after);
  assert.equal(ev.length, 1);
  assert.match(ev[0].moves[0].delta, /отрицательн/, "направление берётся по старому значению: «−0,0» это минус-ноль, и проверка нового его не видит");
});

test("минус-ноль не выдаётся за переход в плюс", () => {
  const before = stateOf(panelOf([ind({ value: "+5", value_num: 5, points: seriesPoints(flat) })]));
  const after = panelOf([ind({ value: "-0,0", value_num: -0, observed_at: "2026-07-21", points: seriesPoints([...flat, 1]) })]);
  const ev = diff(before, after);
  assert.match(ev[0].moves[0].delta, /отрицательн/, "было +5, стало −0,0 — это переход вниз");
});

test("топтание у нуля не помечается сменой знака", () => {
  // +0,1 → −0,0 формально пересекает ноль, но обе стороны ничтожны на фоне обычного шага
  const before = stateOf(panelOf([ind({ value: "+0,1", value_num: 0.1, points: seriesPoints(flat) })]));
  const after = panelOf([ind({ value: "-0,0", value_num: -0.02, observed_at: "2026-07-21", points: seriesPoints([...flat, 0.12]) })]);
  const ev = diff(before, after);
  assert.equal(ev.length, 1, "данные всё равно рассылаются");
  assert.equal(ev[0].moves[0].delta, "", "но громкой пометки быть не должно");
});

test("без накопленного ряда показатель не глушится", () => {
  const before = stateOf(panelOf([ind({ value: "1", value_num: 1 })]));
  const ev = diff(before, panelOf([ind({ value: "1.0001", value_num: 1.0001, observed_at: "2026-07-21" })]));
  assert.equal(ev.length, 1, "нет базы для суждения — молчать нельзя");
});

test("пояснение относится к показателю, который реально попал в сообщение", () => {
  // у первого показателя видимое значение не изменилось — он выпадает; пояснение должно
  // остаться от второго, иначе комментарий объясняет не то, что видит читатель
  const before = stateOf(panelOf([
    ind({ id: "mvrv_cycle", value: "смешанно", value_num: null }),
    ind({ id: "realized_pnl", value: "1.0016", value_num: 1.0016 }),
  ]));
  const after = panelOf([
    ind({ id: "mvrv_cycle", value: "смешанно", value_num: null, observed_at: "2026-07-21", score: 1 }),
    ind({ id: "realized_pnl", value: "1.0013", value_num: 1.0013, observed_at: "2026-07-21" }),
  ]);
  const ev = diff(before, after);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].moves.length, 1, "показатель без видимого изменения в сообщение не попадает");
  assert.equal(ev[0].plain.length, 1, "и его пояснение — тоже");
  assert.match(ev[0].plain[0], /прибыль или в убыток/, `пояснение должно быть о показателе из сообщения: ${ev[0].plain}`);
});

/* ---- нормализация источников ---- */

test("технические имена источников не уходят в заголовок", () => {
  const cases = [
    ["The Block (tbstat) + SosoValue · Coinbase", "Потоки в биткоин-ETF"],
    ["The Block (tbstat)", "Потоки в биткоин-ETF"],
    ["coinmetrics", "Ончейн-данные сети биткоина"],
    ["Coin Metrics · network", "Ончейн-данные сети биткоина"],
    ["CFTC · The Block (tbstat)", "Отчёт CFTC о позициях во фьючерсах"],
    ["mempool.space", "Сеть биткоина"],
    ["DefiLlama · exchange fallback", "Стейблкоины"],
    ["fiscaldata", "Минфин США"],
  ];
  for (const [raw, want] of cases) assert.equal(humanRelease(raw), want, `«${raw}» → ожидалось «${want}»`);
});

test("одна и та же публикация не расщепляется из-за приписки провайдера", () => {
  const a = { id: "etf_regime", source: "The Block (tbstat) + SosoValue · Coinbase" };
  const b = { id: "etf_1d", source: "The Block (tbstat)" };
  assert.equal(releaseOf(a), releaseOf(b), "оба про потоки ETF — сообщение должно быть одно");
});

test("разные публикации одного провайдера не сливаются", () => {
  assert.notEqual(releaseOf({ id: "two_year", source: "fred" }), releaseOf({ id: "liquidity_regime", source: "fred" }),
    "2-летка выходит каждый рабочий день, баланс ФРС — раз в неделю; это разные события");
});

test("порог из фразы панели разбирается вместе с типографским минусом", () => {
  assert.equal(thresholdFrom("до 35%: композит ≤ −13"), -13);
  assert.equal(thresholdFrom("до 100%: композит ≥ +33 и опереж ≥ +13"), 33);
  assert.equal(thresholdFrom("апгрейд разблокируется, когда детектор выйдет"), null);
});

test("промежуточное «наблюдение» детектора не рассылается", () => {
  const det = (state) => [{ id: "d1", name: "Нефтяной шок / Ормуз", state, inputs: "", note: "" }];
  const base = { allocation: { pct: 65 } };
  const calm = stateOf(panelOf([ind({})], { ...base, detectors: det("calm") }));
  const realLog = console.log; console.log = () => {};
  try {
  assert.equal(diff(calm, panelOf([ind({})], { ...base, detectors: det("watch") })).length, 0, "«подтверждений 1/3» — не новость");
  const watch = stateOf(panelOf([ind({})], { ...base, detectors: det("watch") }));
  assert.equal(diff(watch, panelOf([ind({})], { ...base, detectors: det("fired") })).length, 1, "срабатывание — новость");
  const fired = stateOf(panelOf([ind({})], { ...base, detectors: det("fired") }));
  assert.equal(diff(fired, panelOf([ind({})], { ...base, detectors: det("calm") })).length, 1, "снятие — тоже");
  } finally { console.log = realLog; }
});

test("у каждого показателя макро-панели есть человеческое имя", () => {
  const missing = Object.keys(MACRO_CADENCE).filter((id) => !HUMAN[id]);
  assert.deepEqual(missing, [], `без записи в словаре в сообщение уедет внутренняя подпись карточки: ${missing}`);
});

const allocOf = (pct, blocks, extra = {}) => ({
  pct,
  bands: { adverse: -20, supportive: 20 },
  blocks,
  hold: { state: "defensive", candidate: "defensive", count: 21 },
  ...extra,
});
const BLOCKS_TWO_ADVERSE = {
  macro: { title: "мировые условия", score: 16.7, families: 3, step: 50 / 3 },
  demand: { title: "спрос на биткоин", score: -31.25, families: 4, step: 12.5 },
  cycle: { title: "стадия цикла", score: -25, families: 5, step: 10 },
};
const BLOCKS_ONE_ADVERSE = {
  macro: { title: "мировые условия", score: 16.7, families: 3, step: 50 / 3 },
  demand: { title: "спрос на биткоин", score: 5, families: 4, step: 12.5 },
  cycle: { title: "стадия цикла", score: -25, families: 5, step: 10 },
};
const tierOf = (before, after) => {
  const ev = diff(stateOf(panelOf([ind({})], { allocation: before })), panelOf([ind({})], { allocation: after }));
  return ev[0].stability[0];
};

test("решение, где ближайшему фактору хватит одного шага, — шаткое даже при двух неблагоприятных", () => {
  const st = tierOf(allocOf(80, BLOCKS_TWO_ADVERSE), allocOf(5, BLOCKS_TWO_ADVERSE));
  assert.equal(st.tier, "shaky", "лестница поднимает долю уже при развороте ОДНОГО фактора");
  assert.match(st.reason.join(" "), /ближе всего к развороту/);
  assert.match(st.reason.join(" "), /не полностью, а на одну ступень/, "надо честно сказать, что возврат будет частичным");
});

test("когда развернуться должны несколько показателей — решение устойчиво", () => {
  // оба неблагоприятных фактора глубоко в зоне: ближайший к выходу — и тот в трёх ступенях
  const deep = {
    ...BLOCKS_TWO_ADVERSE,
    demand: { title: "спрос на биткоин", score: -60, families: 4, step: 12.5 },
    cycle: { title: "стадия цикла", score: -55, families: 5, step: 10 },
  };
  const st = tierOf(allocOf(80, deep), allocOf(5, deep));
  assert.equal(st.tier, "firm");
});

test("решение на одном пограничном факторе — шаткое", () => {
  const st = tierOf(allocOf(80, BLOCKS_ONE_ADVERSE), allocOf(20, BLOCKS_ONE_ADVERSE));
  assert.equal(st.tier, "shaky");
  assert.match(st.reason.join(" "), /достаточно, чтобы один показатель/);
});

test("аварийный переключатель — отдельный класс, а не «шаткое»", () => {
  const st = tierOf(allocOf(65, BLOCKS_ONE_ADVERSE), allocOf(0, BLOCKS_ONE_ADVERSE, { override: true }));
  assert.equal(st.tier, "forced");
  assert.match(st.reason.join(" "), /аварийн/);
});

test("в объяснении устойчивости нет внутреннего жаргона", () => {
  const jargon = /блок|пункт|шаг|групп|композит|балл|зон[аы]/i;
  for (const st of [
    tierOf(allocOf(80, BLOCKS_TWO_ADVERSE), allocOf(5, BLOCKS_TWO_ADVERSE)),
    tierOf(allocOf(80, BLOCKS_ONE_ADVERSE), allocOf(20, BLOCKS_ONE_ADVERSE)),
  ]) {
    const text = st.reason.join(" ");
    assert.ok(!jargon.test(text), `внутренняя терминология снова протекла наружу: «${text}»`);
  }
});

test("журнал смен доли даёт частоту откатов", () => {
  const day = 86400e3;
  // журнал СМЕН (а не ряд наблюдений): три смены, две из них — возврат к прежней доле
  const alloc_changes = [
    { t: 1e12, from: 80, to: 20 },
    { t: 1e12 + day, from: 20, to: 80 },
    { t: 1e12 + 2 * day, from: 80, to: 20 },
    { t: 1e12 + 3 * day, from: 20, to: 80 },
  ];
  const prev = { ...stateOf(panelOf([ind({})], { allocation: allocOf(80, BLOCKS_TWO_ADVERSE) })), alloc_changes };
  const ev = diff(prev, panelOf([ind({})], { allocation: allocOf(20, BLOCKS_TWO_ADVERSE) }));
  const text = ev[0].stability[0].reason.join(" ");
  assert.match(text, /откатил/, `база частот обязана попасть в объяснение: ${text}`);
});

test("журнал смен переживает подрезку ряда наблюдений", () => {
  const many = Array.from({ length: 500 }, (_, k) => ({ t: 1e12 + k * 3600e3, pct: 5 }));
  const panel = panelOf([ind({})], { allocation: allocOf(5, BLOCKS_TWO_ADVERSE) });
  const trend = appendTrend(many, panel);
  assert.ok(trend.length <= 400, "ряд наблюдений подрезается");
  const changes = appendChanges([{ t: 1e11, from: 80, to: 5 }], panel, { pct: 80 });
  assert.equal(changes.length, 2, "а журнал смен — нет");
  assert.equal(changes[1].to, 5);
});

test("опубликованная панелью история решений сразу даёт базу частот", () => {
  const hist = [
    { t: "2026-07-21T01:00:00Z", decision: { target_pct: 5 } },
    { t: "2026-07-21T02:00:00Z", decision: { target_pct: 20 } },
    { t: "2026-07-22T02:00:00Z", decision: { target_pct: 80 } },
    { t: "2026-07-24T02:00:00Z", decision: { target_pct: 45 } },
    { t: "2026-07-24T03:00:00Z", decision: { target_pct: 5 } },
  ];
  const ch = decisionChanges(hist);
  assert.equal(ch.length, 4, `должно быть 4 смены: ${JSON.stringify(ch)}`);
  assert.deepEqual([ch[0].from, ch[0].to], [5, 20]);
  assert.equal(decisionChanges([]).length, 0);
  assert.equal(decisionChanges(undefined).length, 0);
});

test("сообщение о доле собирается с разделами «почему» и «устойчиво ли»", () => {
  const msg = renderMessage(
    { kind: "allocation", title: "Доля акций сокращена", before: "85%", after: "65%", causes: ["причина"], stability: ["запас 5 пунктов"] },
    "комментарий"
  );
  assert.match(msg, /Что за этим стоит/);
  assert.match(msg, /Насколько это устойчиво/);
  assert.match(msg, /85% → <b>65%<\/b>/);
});

/* ---- переписанная история ряда: что именно, когда и на сколько ---- */

const withPoints = (pts, o = {}) => ind({ series: undefined, points: pts, ...o });
const day = (iso) => Date.parse(iso + "T00:00:00Z");

test("переписанная точка ряда показывается с датой и «было → стало»", () => {
  const before = stateOf(panelOf([withPoints({ [day("2026-05-27")]: 100, [day("2026-05-28")]: 110, [day("2026-05-29")]: 120 })]));
  const after = panelOf([withPoints({ [day("2026-05-27")]: 115, [day("2026-05-28")]: 110, [day("2026-05-29")]: 120 })]);
  const ev = diff(before, after);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "revision");
  assert.match(ev[0].detail, /27\.05\.2026/, "дата переписанной точки обязана быть в сообщении");
  assert.equal(ev[0].moves[0].before, "100");
  assert.equal(ev[0].moves[0].after, "115");
  assert.equal(ev[0].moves[0].delta, "+15,0%", "проценты пишутся по-русски, с запятой");
});

test("последняя точка ряда — не ревизия: она ещё формируется", () => {
  const before = stateOf(panelOf([withPoints({ [day("2026-05-27")]: 100, [day("2026-05-28")]: 110 })]));
  const after = panelOf([withPoints({ [day("2026-05-27")]: 100, [day("2026-05-28")]: 999, [day("2026-05-29")]: 130 })]);
  assert.equal(diff(before, after).length, 0, "движение свежей точки — это рынок, а не пересмотр истории");
});

test("несколько переписанных точек — одно сообщение с периодом", () => {
  const base = {};
  for (let d = 1; d <= 10; d++) base[day(`2026-05-${String(d).padStart(2, "0")}`)] = d * 10;
  const before = stateOf(panelOf([withPoints({ ...base })]));
  const moved = { ...base, [day("2026-05-02")]: 21, [day("2026-05-03")]: 31, [day("2026-05-04")]: 41 };
  const ev = diff(before, panelOf([withPoints(moved)]));
  assert.equal(ev.length, 1);
  assert.match(ev[0].detail, /период 02\.05\.2026 — 04\.05\.2026/);
  assert.equal(ev[0].moves.length, 3);
});

test("новые точки в конце ряда ревизией не считаются", () => {
  const before = stateOf(panelOf([withPoints({ [day("2026-05-27")]: 100, [day("2026-05-28")]: 110 })]));
  const after = panelOf([withPoints({ [day("2026-05-27")]: 100, [day("2026-05-28")]: 110, [day("2026-05-29")]: 130, [day("2026-05-30")]: 140 })]);
  assert.equal(diff(before, after).length, 0);
});

test("дребезг последнего знака не выдаётся за пересмотр", () => {
  const before = stateOf(panelOf([withPoints({ [day("2026-05-27")]: 1e20, [day("2026-05-28")]: 2e20 })]));
  const after = panelOf([withPoints({ [day("2026-05-27")]: 1e20 * (1 + 1e-12), [day("2026-05-28")]: 2e20 })]);
  assert.equal(diff(before, after).length, 0);
});

test("возврат точки к уже показанному значению — не сообщение, а качок источника", () => {
  const pts = (v) => ({ [day("2026-05-27")]: v, [day("2026-05-28")]: 200, [day("2026-05-29")]: 300 });
  const s0 = stateOf(panelOf([withPoints(pts(100))]));
  const first = diff(s0, panelOf([withPoints(pts(115))]));
  assert.equal(first.length, 1, "первый пересмотр показывается");
  const seen = rememberRevised({}, first, Date.parse("2026-07-24T00:00:00Z"));
  const s1 = { ...stateOf(panelOf([withPoints(pts(115))])), revised_points: seen };
  const realLog2 = console.log; console.log = () => {};
  let back;
  try { back = diff(s1, panelOf([withPoints(pts(100))])); } finally { console.log = realLog2; }
  assert.equal(back.length, 0, "источник вернул прежнее значение — новости в этом нет");
  const s2 = { ...stateOf(panelOf([withPoints(pts(115))])), revised_points: seen };
  assert.equal(diff(s2, panelOf([withPoints(pts(130))])).length, 1, "новое, ещё не показанное значение — событие");
});

test("память о показанных значениях протухает и не растёт бесконечно", () => {
  const now = Date.parse("2026-07-24T00:00:00Z");
  const old = { "x|1": { v: [1], at: "2026-01-01T00:00:00Z" }, "x|2": { v: [2], at: "2026-07-20T00:00:00Z" } };
  const kept = rememberRevised(old, [], now);
  assert.deepEqual(Object.keys(kept), ["x|2"], "запись старше 90 дней уходит");
  let acc = {};
  for (let i = 0; i < 20; i++) acc = rememberRevised(acc, [{ revisedPoints: [{ id: "x", t: 7, after: i }] }], now);
  assert.ok(acc["x|7"].v.length <= 6, `список значений точки не должен расти без предела: ${acc["x|7"].v.length}`);
});

test("крупные и мелкие порядки печатаются читаемо", () => {
  const before = stateOf(panelOf([withPoints({ [day("2026-05-27")]: 7.31e20, [day("2026-05-28")]: 1 })]));
  const ev = diff(before, panelOf([withPoints({ [day("2026-05-27")]: 8.36e20, [day("2026-05-28")]: 1 })]));
  assert.match(ev[0].moves[0].before, /10\^20/, "хешрейт обязан читаться, а не тянуться двадцатью нулями");
  assert.equal(ev[0].moves[0].delta, "+14,4%");
});

test("шаблонный комментарий не бывает пустым ни для одного типа события", () => {
  const kinds = [
    { kind: "target", before: "80%", after: "5%" },
    { kind: "verdict" },
    { kind: "detector", after: "СРАБОТАЛ" },
    { kind: "zone", beforeScore: 1, afterScore: -1, note: "Заметка. Хвост." },
    { kind: "release", moves: [{ name: "A", before: "1", after: "2" }] },
    { kind: "revision" },
  ];
  for (const ev of kinds) {
    const c = templateComment(ev);
    assert.ok(c && c.length > 20, `пустой комментарий у ${ev.kind}`);
  }
});

test("шаблон релиза не вываливает заметки всех карточек", () => {
  const c = templateComment({ kind: "release", moves: [{ name: "A" }], note: "Очень длинная заметка про карточку." });
  assert.ok(!c.includes("Очень длинная заметка"), "заметки карточек уходят только в контекст LLM");
});

test("HTML в данных экранируется, разметка сообщения — нет", () => {
  const msg = renderMessage({ kind: "zone", title: "MVRV <25 & прочее", before: "a", after: "b", detail: "" }, "ok");
  assert.ok(msg.includes("MVRV &lt;25 &amp; прочее"), "значения обязаны экранироваться");
  assert.ok(msg.includes("<b>"), "собственная разметка сообщения должна остаться");
});

test("сообщение не превышает лимит Telegram", () => {
  const msg = renderMessage({ kind: "release", title: "T", before: "", after: "", detail: "x".repeat(5000) }, "y".repeat(5000));
  assert.ok(msg.length <= 4000, `длина ${msg.length}`);
});

test("снимок BTC-панели читается в общую форму", () => {
  const snap = {
    generated_at: "2026-07-24T10:00:00.000Z",
    verdict: "ЗАЩИТНЫЙ РЕЖИМ",
    scores: { strategic: -15 },
    regime: { strategic: "defensive" },
    decision: { target_pct: 5, reason_codes: ["base:defensive"] },
    metrics: [
      { id: "m1", name: "Карточка", value: "1", value_num: 1, score: 0, vote: true, observed_at: "2026-07-22T00:00:00.000Z", source: "FRED", note: "n" },
      { id: "m2", name: "Живой фид", value: "2", value_num: 2, score: null, vote: false, observed_at: "2026-07-24T09:59:00.000Z", source: "Coinbase", note: "n" },
    ],
    detectors: [{ id: "d", name: "Д", state: "calm", inputs: "in", logic: "log" }],
    source_revision_alerts: [{ source: "etf", observed_at: "2026-07-23T12:00:00.000Z", changed_rows: 1, previous_data_sha256: "abcdef1234" }],
  };
  // Предупреждение о безымянной карточке — ОЖИДАЕМЫЙ вывод этой фикстуры. В логе CI оно
  // выглядело как боевая тревога, поэтому глушим — но проверяем, что оно вообще прозвучало.
  let warned = "";
  const realLog = console.log;
  console.log = (...a) => { warned += a.join(" ") + " "; };
  let p;
  try {
    p = fromSnapshotJSON(snap);
  } finally {
    console.log = realLog;
  }
  assert.match(warned, /нет человеческого имени/, "карточка без записи в словаре обязана давать предупреждение");
  assert.equal(p.verdict.word, "ЗАЩИТНЫЙ РЕЖИМ");
  assert.equal(p.target.pct, 5);
  assert.equal(p.indicators[0].scheduled, true, "суточной свежести наблюдение — публикация по календарю");
  assert.equal(p.indicators[1].scheduled, false, "наблюдение минутной свежести — живой фид");
  assert.equal(p.revisions.length, 1);
  assert.match(p.revisions[0].text, /переписал/);
});

test("карточка на встроенной оценке не порождает событий", () => {
  const before = stateOf(panelOf([ind({ zone: "норма", score: 1, value: "1", value_num: 1 })]));
  const degradedNow = panelOf([ind({ zone: "стресс", score: -1, value: "9", value_num: 9, degraded: true })]);
  assert.equal(diff(before, degradedNow).length, 0, "сбой источника — не рыночное событие");
  const wasDegraded = stateOf(panelOf([ind({ zone: "норма", score: 1, value: "1", value_num: 1, degraded: true })]));
  const healthyNow = panelOf([ind({ zone: "стресс", score: -1, value: "9", value_num: 9 })]);
  assert.equal(diff(wasDegraded, healthyNow).length, 0, "возврат источника — тоже не событие");
});

test("ключ доставленного различает одно событие с разными числами", () => {
  const a = { key: "rel:fred|2026-07-21", before: "", after: "", moves: [{ after: "1" }] };
  const b = { key: "rel:fred|2026-07-21", before: "", after: "", moves: [{ after: "2" }] };
  assert.notEqual(sentKey(a), sentKey(b), "пересмотренное значение обязано считаться новым событием");
  assert.equal(sentKey(a), sentKey({ ...a }));
});

test("индекс доставленного протухает, но не раньше недели", () => {
  const now = Date.parse("2026-07-24T00:00:00Z");
  const kept = pruneSent(
    { fresh: "2026-07-23T00:00:00Z", old: "2026-07-10T00:00:00Z", broken: "не дата" },
    now
  );
  assert.deepEqual(Object.keys(kept), ["fresh"]);
});

test("проверочное сообщение показывает текущее состояние панели", () => {
  const p = panelOf([ind({ name: "Карточка" })], {
    verdict: { word: "ДЕРЖАТЬ", extra: "балл +9" },
    allocation: { pct: 20 },
    detectors: [
      { id: "a", name: "Спокойный", state: "calm", inputs: "", note: "" },
      { id: "b", name: "Тревожный", state: "fired", inputs: "", note: "" },
    ],
  });
  const m = pingMessage(p);
  assert.match(m, /Проверка связи/);
  assert.match(m, /ДЕРЖАТЬ/);
  assert.match(m, /20%/);
  assert.match(m, /Тревожный \(СРАБОТАЛ\)/, "нештатные детекторы обязаны быть названы");
  assert.ok(!m.includes("Спокойный"), "спокойные детекторы не перечисляются поимённо");
});

/* ---- каноническая ступень: state.decision → журнал решений → сообщение ---- */

// Решение страницы по контракту v5 (DECISION_SPEC): всё, что не задано, — спокойная ступень 2.
const REGIME_OF = ["crisis", "elevated", "moderate"];
const WORD_OF = { crisis: "КРИЗИС · ЗАЩИТА", elevated: "РИСК ПОВЫШЕН", moderate: "РИСК УМЕРЕННЫЙ" };
const TRIG_OF = [
  { down: null, up: { pct: 50, composite: -27 } },
  { down: { pct: 0, composite: -33 }, up: { pct: 100, composite: -7 } },
  { down: { pct: 50, composite: -13 }, up: null },
];
const decisionOf = (o = {}) => {
  const rung = o.rung ?? 2;
  const since = o.since ?? "2026-09-30";
  const regime = o.regime ?? REGIME_OF[rung];
  return {
    v: 5, settled: true, noData: false, dataAsOf: o.dataAsOf ?? since,
    composite: 17.7, lead: -3.6, coin: 35,
    regime, regimeWord: WORD_OF[regime] || "", raw: rung, rung, pct: RUNG_PCT[rung], since,
    pend: null, pendPct: null, pendSession: null, override: false, frozen: false, freezeBy: [],
    triggers: TRIG_OF[rung], tail: { p: 0.1, base: 0.17 },
    action: "Держите долю акций по ступени.", source: "writer",
    memory: { v: 2, rung, since, pend: null, pendSession: null },
    ...o,
  };
};
// Панель после headless-прогона: решение уже разобрано canonicalize (как в main).
const canonPanel = (dec, prevLedger = null, extra = {}) => {
  const p = panelOf([ind({})], { source: "page", decision: dec, snapshot_at: `${dec.dataAsOf}T20:06:00.000Z`, ...extra });
  const r = mute(() => canonicalize(p, prevLedger, { snapshotAt: p.snapshot_at, spx: 7666.45, now: Date.parse("2026-10-02T12:00:00Z") }));
  return { panel: p, ...r };
};
const ledgerAt = (rung, since = "2026-09-29") => buildLedger(null, decisionOf({ rung, since }), { spx: 7600, now: 0 });
const allocEvents = (evs) => evs.filter((e) => e.kind === "allocation");

test("каноническая смена доли идёт от журнала и говорит новыми словами", () => {
  const prevLedger = ledgerAt(2);
  const base = stateOf(panelOf([ind({})]));
  const { panel: p } = canonPanel(decisionOf({ rung: 1, since: "2026-10-01", composite: -14.2 }), prevLedger);
  const ev = allocEvents(diff({ ...base, ledger: prevLedger }, p));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].title, "Доля акций сокращена");
  assert.equal(ev[0].before, "100% нормы");
  assert.equal(ev[0].after, "50% нормы");
  assert.match(ev[0].detail, /РИСК УМЕРЕННЫЙ → РИСК ПОВЫШЕН/, "режим называется словами шапки");
  assert.match(ev[0].detail, /01\.10\.2026/, "сессия данных указана");
  assert.match(ev[0].key, /@2026-10-01$/, "в ключе — дата смены");
  assert.match(ev[0].causes[0], /Сводная оценка рынка −14,2/);
  const msg = renderMessage(ev[0], "к");
  assert.match(msg, /100% нормы → <b>50% нормы<\/b>/);
  assert.ok(!/85%|65%|35%/.test(msg), `старая пятиступенчатая лестница не должна протекать: ${msg}`);
});

test("первый канонический прогон без журнала — база, а не сообщение", () => {
  const legacy = stateOf(panelOf([ind({})], { allocation: { pct: 85 } }));
  const { panel: p } = canonPanel(decisionOf({ rung: 2 }));
  assert.equal(allocEvents(diff({ ...legacy, ledger: null }, p)).length, 0, "«85% → 100%» на смене лестницы — не событие");
});

test("каноническая ступень без смены против журнала — молчит", () => {
  const prevLedger = ledgerAt(1);
  const { panel: p } = canonPanel(decisionOf({ rung: 1, since: "2026-09-29", composite: -15 }), prevLedger);
  assert.equal(allocEvents(diff({ ...stateOf(panelOf([ind({})])), ledger: prevLedger }, p)).length, 0);
});

test("объявленная ступень важнее журнала: упавшая рассылка не теряет смену", () => {
  // Прошлый прогон записал журнал (ступень 1), но Telegram упал — база состояния осталась на 2.
  const announced = stateOf(canonPanel(decisionOf({ rung: 2 })).panel);
  const ledgerMoved = ledgerAt(1, "2026-10-01");
  const { panel: p } = canonPanel(decisionOf({ rung: 1, since: "2026-10-01", dataAsOf: "2026-10-02" }), ledgerMoved);
  const ev = allocEvents(diff({ ...announced, ledger: ledgerMoved }, p));
  assert.equal(ev.length, 1, "смена, которую читатель ещё не получил, обязана уйти");
  assert.equal(ev[0].after, "50% нормы");
});

test("сбой данных (noData) не порождает сообщения о доле", () => {
  const prevLedger = ledgerAt(2);
  const base = { ...stateOf(panelOf([ind({})])), ledger: prevLedger };
  // Даже если ступень почему-то другая — при покрытии < 60% доли нет вовсе (фантом «85% → 60% → 85%»).
  for (const rung of [2, 1]) {
    const { panel: p } = canonPanel(decisionOf({ rung, noData: true, regime: "nodata", regimeWord: "НЕДОСТАТОЧНО ДАННЫХ" }), prevLedger);
    assert.equal(p.allocation, null);
    assert.equal(allocEvents(diff(base, p)).length, 0, `noData со ступенью ${rung} дал сообщение о доле`);
  }
  // Рубильник — исключение: защита немедленно и при любых данных.
  const { panel: forced } = canonPanel(decisionOf({ rung: 0, noData: true, override: true, since: "2026-10-01" }), prevLedger);
  const ev = allocEvents(diff(base, forced));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].after, "0% нормы");
  assert.equal(ev[0].stability[0].tier, "forced");
});

test("A→B→A→B за неделю — четыре сообщения, повтор того же прогона — ни одного", () => {
  let ledger = ledgerAt(2);
  let state = stateOf(canonPanel(decisionOf({ rung: 2 }), ledger).panel);
  const sent = {};
  let delivered = 0;
  let last = null;
  for (const [rung, since] of [[1, "2026-10-01"], [2, "2026-10-02"], [1, "2026-10-05"], [2, "2026-10-06"]]) {
    const run = canonPanel(decisionOf({ rung, since, composite: rung === 2 ? 0 : -20 }), ledger);
    const evs = allocEvents(diff({ ...state, ledger }, run.panel)).filter((e) => !sent[sentKey(e)]);
    for (const e of evs) { sent[sentKey(e)] = "2026-10-06T00:00:00Z"; delivered++; }
    last = { before: { ...state, ledger }, panel: run.panel };
    state = stateOf(run.panel);
    ledger = run.ledger;
  }
  assert.equal(delivered, 4, "настоящие повторные переходы не должны глушиться индексом доставленного");
  assert.equal(ledger.transitions.length, 4, "журнал записал все четыре смены");
  const again = allocEvents(diff(last.before, last.panel)).filter((e) => !sent[sentKey(e)]);
  assert.equal(again.length, 0, "перезапуск того же прогона не шлёт ту же смену второй раз");
});

test("переходный режим (полоса): A→B→A→B на разных снимках — тоже четыре сообщения", () => {
  let state = stateOf(panelOf([ind({})], { allocation: { pct: 85 }, snapshot_at: "2026-10-01T10:00:00Z" }));
  const sent = {};
  let delivered = 0;
  [65, 85, 65, 85].forEach((pct, k) => {
    const p = panelOf([ind({})], { allocation: { pct }, snapshot_at: `2026-10-0${k + 2}T10:00:00Z` });
    for (const e of allocEvents(diff(state, p)).filter((e) => !sent[sentKey(e)])) { sent[sentKey(e)] = "x"; delivered++; }
    state = stateOf(p);
  });
  assert.equal(delivered, 4);
});

test("повторное срабатывание сигнала риска на новом снимке — снова сообщение", () => {
  const det = (state) => [{ id: "fund", name: "Фондинговый стресс", state, inputs: "", note: "" }];
  let state = stateOf(panelOf([ind({})], { detectors: det("calm") }));
  const sent = {};
  let delivered = 0;
  ["fired", "calm", "fired", "calm"].forEach((st, k) => {
    const p = panelOf([ind({})], { detectors: det(st), snapshot_at: `2026-10-0${k + 1}T10:00:00Z` });
    const evs = diff(state, p).filter((e) => e.kind === "risk" && !sent[sentKey(e)]);
    for (const e of evs) { sent[sentKey(e)] = "x"; delivered++; }
    if (k === 2) {
      // тот же снимок прогоняется ещё раз (перезапуск) — ключ уже в индексе
      assert.equal(diff(state, p).filter((e) => !sent[sentKey(e)]).length, 0, "повтор того же снимка не шлёт");
    }
    state = stateOf(p);
  });
  assert.equal(delivered, 4, "второе срабатывание фондинга глушилось неделю, хотя база сдвигалась");
});

/* ---- «насколько устойчиво»: запас до порога ОТКАТА, а не до порога дальнейшего движения ---- */

const canonStability = (prevRung, dec) => {
  const announced = stateOf(canonPanel(decisionOf({ rung: prevRung })).panel);
  const { panel: p } = canonPanel(dec, ledgerAt(prevRung));
  const ev = allocEvents(diff({ ...announced, ledger: ledgerAt(prevRung) }, p));
  assert.equal(ev.length, 1);
  return { st: ev[0].stability[0], text: ev[0].stability[0].reason.join(" | ") };
};

test("после понижения запас меряется до порога ПОВЫШЕНИЯ, а вернуть долю может условие ↑", () => {
  const { text } = canonStability(2, decisionOf({ rung: 1, since: "2026-10-01", composite: -14 }));
  assert.match(text, /улучшиться на 7 пунктов/, `после понижения доле нужно улучшение до −7: ${text}`);
  assert.ok(!/ухудшиться/.test(text), `«ухудшиться» после понижения — мерка не в ту сторону: ${text}`);
  assert.match(text, /вернуть 100% нормы может рост сводной оценки рынка до −7/);
});

test("после повышения запас меряется до порога ПОНИЖЕНИЯ, а вернуть долю может условие ↓", () => {
  const { text } = canonStability(1, decisionOf({ rung: 2, since: "2026-10-01", composite: 2 }));
  assert.match(text, /ухудшиться ещё на 15 пунктов/, text);
  assert.match(text, /вернуть 50% нормы может падение сводной оценки рынка до −13/, `строка отката обязана печатать условие ↓: ${text}`);
});

test("переходный разбор полосы тоже берёт порог отката по направлению смены", () => {
  const strip = { up: "до 85%: композит ≥ +13", down: "до 35%: композит ≤ −13" };
  const down = diff(stateOf(panelOf([ind({})], { allocation: { pct: 85 } })), panelOf([ind({})], { allocation: { pct: 65, score: 5, ...strip } }));
  const dt = down[0].stability[0].reason.join(" | ");
  assert.match(dt, /улучшиться на 8 пунктов/, dt);
  assert.match(dt, /вернуть прежнюю долю может: до 85%/, dt);
  const up = diff(stateOf(panelOf([ind({})], { allocation: { pct: 65 } })), panelOf([ind({})], { allocation: { pct: 85, score: 15, up: "до 100%: композит ≥ +33 и опереж ≥ +13", down: "до 65%: композит < +7" } }));
  const ut = up[0].stability[0].reason.join(" | ");
  assert.match(ut, /ухудшиться ещё на 8 пунктов/, ut);
  assert.match(ut, /вернуть прежнюю долю может: до 65%/, `после повышения печаталось условие дальнейшего повышения: ${ut}`);
});

test("понижение при замороженном апгрейде: откат назван заблокированным, а не числом", () => {
  const { text } = canonStability(2, decisionOf({ rung: 1, since: "2026-10-01", composite: -14, frozen: true, freezeBy: ["Фондинг"] }));
  assert.match(text, /вернуть 100% нормы сейчас нельзя/);
  assert.match(text, /нехватки долларов/, "детектор называется человеческими словами");
  assert.ok(!/пункт/.test(text), `запас до порога при заморозке ничего не значит: ${text}`);
});

test("условие отката уже выполняется — решение шаткое", () => {
  const { st, text } = canonStability(2, decisionOf({ rung: 1, since: "2026-10-01", composite: -5 }));
  assert.equal(st.tier, "shaky");
  assert.match(text, /условие отката уже выполняется/);
});

test("журнал смен ступени даёт базу частот откатов", () => {
  let ledger = ledgerAt(2, "2026-09-01");
  for (const [rung, since] of [[1, "2026-09-02"], [2, "2026-09-03"], [1, "2026-09-04"]]) ledger = buildLedger(ledger, decisionOf({ rung, since }), { now: 0 });
  const announced = stateOf(canonPanel(decisionOf({ rung: 1, since: "2026-09-04" })).panel);
  const { panel: p } = canonPanel(decisionOf({ rung: 2, since: "2026-09-05", composite: 0 }), ledger);
  const text = allocEvents(diff({ ...announced, ledger }, p))[0].stability[0].reason.join(" ");
  assert.match(text, /откатил/, `смены из журнала обязаны попасть в эмпирику: ${text}`);
});

/* ---- журнал решений ---- */

test("журнал: первая версия — память и дневник, смен ещё нет", () => {
  const l = buildLedger(null, decisionOf({ rung: 2, dataAsOf: "2026-10-01" }), { snapshotAt: "2026-10-02T12:46:27Z", spx: 7666.45, now: Date.parse("2026-10-02T12:50:00Z") });
  assert.equal(l.v, 1);
  assert.equal(l.updated_at, "2026-10-02T12:50:00.000Z");
  assert.equal(l.snapshot_at, "2026-10-02T12:46:27Z");
  assert.equal(l.dataAsOf, "2026-10-01");
  assert.deepEqual(l.memory, { v: 2, rung: 2, since: "2026-09-30", pend: null, pendSession: null });
  assert.equal(l.transitions.length, 0, "сид — не смена");
  assert.deepEqual(l.diary, [{ d: "2026-10-01", c: 17.7, l: -3.6, r: 2, g: "moderate", spx: 7666.45, p: 0.1 }]);
  assert.equal(l.decision.regimeWord, "РИСК УМЕРЕННЫЙ");
  assert.equal(l.decision.pct, 100);
});

test("журнал: смена ступени дописывается, строка дневника на сессию переписывается", () => {
  const l0 = buildLedger(null, decisionOf({ rung: 2, dataAsOf: "2026-10-01" }), { spx: 7666.45 });
  const l1 = buildLedger(l0, decisionOf({ rung: 1, since: "2026-10-02", dataAsOf: "2026-10-02", composite: -14.26 }), { spx: 7500 });
  assert.deepEqual(l1.transitions, [{ d: "2026-10-02", from: 2, to: 1, composite: -14.3 }]);
  assert.equal(l1.diary.length, 2);
  const l2 = buildLedger(l1, decisionOf({ rung: 1, since: "2026-10-02", dataAsOf: "2026-10-02", composite: -16 }), { spx: null });
  assert.equal(l2.transitions.length, 1, "та же ступень — новой смены нет");
  assert.equal(l2.diary.length, 2, "та же сессия — одна строка");
  assert.equal(l2.diary[1].c, -16, "свежий прогон переписывает строку своей сессии");
  assert.equal(l2.diary[1].spx, 7500, "закрытие S&P не стирается прогоном, у которого его нет");
  const late = buildLedger(l2, decisionOf({ rung: 1, since: "2026-10-02", dataAsOf: "2026-09-30" }), {});
  assert.deepEqual(late.diary.map((x) => x.d), ["2026-09-30", "2026-10-01", "2026-10-02"], "дневник идёт по датам");
});

test("журнал: внутридневная дрожь балла не даёт коммита, значимый сдвиг — даёт", () => {
  const l0 = buildLedger(null, decisionOf({ rung: 2, dataAsOf: "2026-10-01" }), { spx: 7666.45 });
  const jitter = buildLedger(l0, { ...decisionOf({ rung: 2, dataAsOf: "2026-10-01" }), composite: 18.3, tail: { p: 0.104, base: 0.17 } }, { spx: 7666.45 });
  assert.equal(ledgerChanged(l0, jitter), false, "сдвиг на 0,6 пт и 0,4 п.п. риска — не повод для коммита");
  const moved = buildLedger(l0, { ...decisionOf({ rung: 2, dataAsOf: "2026-10-01" }), composite: 19.0 }, { spx: 7666.45 });
  assert.equal(ledgerChanged(l0, moved), true, "сдвиг на 1,3 пт — новая строка");
  assert.equal(moved.diary[0].c, 19);
});

test("журнал: сессия без данных в дневник не идёт", () => {
  const l0 = buildLedger(null, decisionOf({ rung: 2, dataAsOf: "2026-10-01" }), {});
  const l1 = buildLedger(l0, decisionOf({ rung: 2, dataAsOf: "2026-10-02", noData: true }), {});
  assert.deepEqual(l1.diary.map((x) => x.d), ["2026-10-01"]);
});

test("журнал: смены и дневник подрезаются до 200 и 800", () => {
  const prev = {
    memory: { v: 2, rung: 2, since: "2020-01-01", pend: null, pendSession: null },
    transitions: Array.from({ length: 250 }, (_, k) => ({ d: "2020-01-01", from: k % 2 ? 1 : 2, to: k % 2 ? 2 : 1, composite: 0 })),
    diary: Array.from({ length: 900 }, (_, k) => ({ d: new Date(Date.UTC(2020, 0, 1) + k * 864e5).toISOString().slice(0, 10), c: 0, l: 0, r: 2, g: "moderate", spx: 1, p: 0.1 })),
  };
  const l = buildLedger(prev, decisionOf({ rung: 1, since: "2026-10-01", dataAsOf: "2026-10-01" }), {});
  assert.equal(l.transitions.length, 200);
  assert.equal(l.transitions[199].to, 1, "свежая смена остаётся, срезается самое старое");
  assert.equal(l.diary.length, 800);
  assert.equal(l.diary[799].d, "2026-10-01");
});

test("журнал: коммит — только при изменении памяти, смен или дневника", () => {
  const dec = decisionOf({ rung: 2, dataAsOf: "2026-10-01" });
  const l0 = buildLedger(null, dec, { spx: 7666.45, now: 0 });
  assert.equal(ledgerChanged(null, l0), true, "первой версии ещё нет — коммит нужен");
  const same = buildLedger(l0, dec, { spx: 7666.45, snapshotAt: "другой снимок", now: 1e12 });
  assert.equal(ledgerChanged(l0, JSON.parse(JSON.stringify(same))), false, "новое время прогона само по себе коммита не стоит");
  const armed = buildLedger(l0, { ...dec, memory: { ...dec.memory, pend: 1, pendSession: "2026-10-01" } }, { spx: 7666.45 });
  assert.equal(ledgerChanged(l0, armed), true, "взведённая смена — изменение памяти");
  const moved = buildLedger(l0, { ...dec, composite: 12 }, { spx: 7666.45 });
  assert.equal(ledgerChanged(l0, moved), true, "строка дневника сессии изменилась");
});

test("журнал печатается валидным JSON, строка на запись", () => {
  const l = buildLedger(ledgerAt(2), decisionOf({ rung: 1, since: "2026-10-01" }), { spx: 7000 });
  const text = formatLedger(l);
  assert.deepEqual(JSON.parse(text), l);
  assert.ok(text.split("\n").some((s) => s.trim().startsWith('{"d":"2026-10-01","from":2,"to":1')), "смена — одной строкой");
});

test("решение принимается каноническим только от писателя и устоявшимся", () => {
  assert.equal(decisionStatus(null).ok, false);
  assert.equal(decisionStatus(decisionOf()).ok, true);
  assert.match(decisionStatus(decisionOf({ source: "local" })).why, /писателя/);
  assert.match(decisionStatus(decisionOf({ settled: false })).why, /settled/);
  assert.equal(decisionStatus(decisionOf({ v: 4 })).ok, false);
  assert.equal(decisionStatus(decisionOf({ rung: 1, memory: { v: 2, rung: 2 } })).ok, false, "ступень и память расходятся");
  assert.equal(decisionStatus(decisionOf({ rung: 3, memory: { v: 2, rung: 3 } })).ok, false);
});

test("без state.decision — переходный режим: доля из полосы, журнал не пишется", () => {
  const p = panelOf([ind({})], { source: "page", allocation: { pct: 65 } });
  const r = mute(() => canonicalize(p, ledgerAt(2)));
  assert.equal(r.ledger, null);
  assert.deepEqual(p.allocation, { pct: 65 }, "старый разбор полосы остаётся в силе");
});

test("не писатель — ни доли, ни журнала", () => {
  const { panel: p, ledger } = canonPanel(decisionOf({ source: "local" }), ledgerAt(2));
  assert.equal(ledger, null);
  assert.equal(p.allocation, null, "посеянная от вердикта ступень каноничной не является");
});

test("сид при сбое данных журнал не начинает, а при живой памяти журнал ведётся", () => {
  assert.equal(canonPanel(decisionOf({ noData: true })).ledger, null);
  const kept = canonPanel(decisionOf({ noData: true, since: "2026-09-29", dataAsOf: "2026-10-02" }), ledgerAt(2));
  assert.ok(kept.ledger, "память есть — журнал пишется (дневник сессию без данных пропустит)");
  assert.equal(kept.changed, false, "память та же, дневник не тронут — коммита нет");
});

test("непрочитанный журнал — не первый прогон: ни доли, ни записи", () => {
  const announced = stateOf(canonPanel(decisionOf({ rung: 1 })).panel);
  const { panel: p, ledger } = canonPanel(decisionOf({ rung: 2, since: "2026-10-02" }), { unreadable: true });
  assert.equal(ledger, null, "сид от вердикта не должен лечь поверх живой истории");
  assert.equal(p.allocation, null);
  assert.equal(allocEvents(diff({ ...announced, ledger: { unreadable: true } }, p)).length, 0, "сид от вердикта — фантомная «смена»");
});

test("каноническое решение задаёт и долю, и слово шапки", () => {
  const { panel: p, ledger, changed } = canonPanel(decisionOf({ rung: 0, since: "2026-10-01", composite: -40, lead: -15 }), ledgerAt(1));
  assert.equal(p.allocation.canonical, true);
  assert.equal(p.allocation.pct, 0);
  assert.equal(p.verdict.word, "КРИЗИС · ЗАЩИТА");
  assert.equal(changed, true);
  assert.deepEqual(ledger.transitions.map((t) => [t.from, t.to]), [[1, 0]]);
  assert.equal(allocationFromDecision(decisionOf({ noData: true })), null);
});

test("закрытие S&P берётся на дату данных решения", () => {
  const pts = [{ d: "2026-09-30", v: 7651.54 }, { d: "2026-10-01", v: 7666.45 }, { d: "2026-10-02", v: 7700 }];
  assert.equal(closeOn(pts, "2026-10-01"), 7666.45, "закрытие после даты данных в дневник этой сессии не идёт");
  assert.equal(closeOn(pts, ""), 7700);
  assert.equal(closeOn([], "2026-10-01"), null);
  const snap = { responses: { "fred:SP500": { observations: [{ date: "2026-10-01", value: "7666.45" }, { date: "2026-09-30", value: "." }] } } };
  assert.deepEqual(snapshotSpx(snap), [{ d: "2026-10-01", v: 7666.45 }], "пропуск FRED «.» отбрасывается");
});

test("проверка связи называет долю в долях нормы", () => {
  const { panel: p } = canonPanel(decisionOf({ rung: 1, since: "2026-10-01" }), ledgerAt(1));
  const m = pingMessage(p);
  assert.match(m, /РИСК ПОВЫШЕН/);
  assert.match(m, /<b>50%<\/b> стратегической нормы/);
});

testAsync("прошлый журнал: нет файла, null, битый и нормальный", async () => {
  const { mkdtemp, writeFile: wf, rm: rmd } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "ledger-"));
  try {
    assert.equal(await readLedger(join(dir, "нет.json")), null);
    await wf(join(dir, "null.json"), "null\n");
    assert.equal(await readLedger(join(dir, "null.json")), null, "так воркфлоу пишет «ветки ещё нет»");
    await wf(join(dir, "unreadable.json"), '"unreadable"\n');
    assert.deepEqual(await readLedger(join(dir, "unreadable.json")), { unreadable: true }, "ветка есть, но не прочиталась — это не первый прогон");
    await wf(join(dir, "broken.json"), "{\"memory\":");
    let got;
    const said = await quiet(async () => { got = await readLedger(join(dir, "broken.json")); });
    assert.equal(got, null);
    assert.match(said, /не читается/, "битый журнал называется в логе");
    await wf(join(dir, "ok.json"), formatLedger(ledgerAt(1)));
    assert.equal((await readLedger(join(dir, "ok.json"))).memory.rung, 1);
  } finally {
    await rmd(dir, { recursive: true, force: true });
  }
});

/* ---- комментатор LLM: сеть подменяется, ключ фиктивный ---- */

// Тесты фолбэка НАМЕРЕННО провоцируют отказ модели, и её жалоба уезжала в лог CI, выглядя там
// настоящей ошибкой. Такой шум приучает не читать диагностику, поэтому ожидаемый вывод глушится:
// сами сообщения при этом проверяются — тест падает, если жалобы не было вовсе.
// Глушит ОБА потока: часть диагностики идёт через console.log («комментарий получен запасной
// моделью…»), и она утекала в лог CI, выглядя там боевой. Сами сообщения при этом проверяются.
const quiet = async (fn) => {
  const realErr = console.error;
  const realLog = console.log;
  const said = [];
  console.error = (...a) => said.push(a.join(" "));
  console.log = (...a) => said.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.error = realErr;
    console.log = realLog;
  }
  return said.join("\n");
};

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  const realKey = process.env.OPENROUTER_KEY;
  globalThis.fetch = impl;
  process.env.OPENROUTER_KEY = "test-key";
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
    if (realKey === undefined) delete process.env.OPENROUTER_KEY;
    else process.env.OPENROUTER_KEY = realKey;
  }
};
const reply = (content) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
const evs = [{ kind: "zone", title: "A", before: "1", after: "2", detail: "", note: "" }, { kind: "release", title: "B", before: "", after: "", detail: "", note: "" }];
const panel = panelOf([ind({})]);

testAsync("комментарии разбираются из ответа модели", async () => {
  const out = await withFetch(reply('[{"i":0,"text":"первый"},{"i":1,"text":"второй"}]'), () => llmComments(evs, panel));
  assert.deepEqual(out, ["первый", "второй"]);
});

testAsync("основной формат — блоки ===N===", async () => {
  const txt = "===0===\nразбор первого события\n===1===\nразбор второго события";
  const out = await withFetch(reply(txt), () => llmComments(evs, panel));
  assert.deepEqual(out, ["разбор первого события", "разбор второго события"]);
});

testAsync("рассуждение вокруг блоков не мешает разбору", async () => {
  const txt = "Сначала подумаю: событий два, оба про кредит.\n\n===0===\nпервый текст\n\n===1===\nвторой текст\n";
  const out = await withFetch(reply(txt), () => llmComments(evs, panel));
  assert.equal(out[0], "первый текст");
  assert.equal(out[1], "второй текст");
});

testAsync("готовый ответ внутри reasoning принимается — но только с разметкой", async () => {
  const impl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "", reasoning: "===0===\nтекст с разметкой\n===1===\nвторой" } }] }),
  });
  const out = await withFetch(impl, () => llmComments(evs, panel));
  assert.equal(out[0], "текст с разметкой");
});

testAsync("ЧЕРНОВИК РАЗМЫШЛЕНИЙ не выдаётся за разбор", async () => {
  // Боевой случай: бюджета токенов не хватило, content пуст, а в reasoning лежит поток мыслей
  // по-английски — он уехал пользователю целиком. Без разметки такой текст ответом не считается.
  const cot = "The user wants me to analyze a single event: the Fed's balance sheet data.\nKey data points:\n- Net liquidity up 1.8% over 4 weeks\n- wait, monthly -50M seems low";
  const impl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "", reasoning: cot }, finish_reason: "length" }] }) });
  let out, said = "";
  said = await quiet(async () => { out = await withFetch(impl, () => llmComments(evs, panel)); });
  assert.equal(out, null, "черновик — не ответ");
  assert.match(said, /бюджета токенов/, "причина должна быть названа в логе");
});

testAsync("англоязычный разбор до читателя не доходит", async () => {
  const txt = "===0===\nThe spread widened by three basis points, which is a routine move for this indicator and does not change the credit picture materially.\n===1===\nВторое событие разобрано по-русски и остаётся.";
  let out, said = "";
  said = await quiet(async () => { out = await withFetch(reply(txt), () => llmComments(evs, panel)); });
  assert.equal(out[0], null, "английский текст заменяется шаблоном");
  assert.match(out[1], /по-русски/, "русский разбор при этом сохраняется");
  assert.match(said, /не на русском/);
});

testAsync("ломаный текст отбраковывается: транслитерация, арабица, смешение алфавитов", async () => {
  // Все три дефекта наблюдались в живых прогонах бесплатных моделей.
  const broken = [
    "===0===\nЛиквидность растёт несмотря на продолжение kvantitativnogo uzhestocheniya в политике ФРС сегодня.\n===1===\nВторой разбор написан чисто и по-русски, без единого изъяна в тексте.",
    "===0===\nЛиквидность растёт, а на рынке заметны продажи حكومات и связанное с ними давление.\n===1===\nВторой разбор написан чисто и по-русски, без единого изъяна в тексте.",
    "===0===\nПродолжается кванitative tightening, и это давит на длинные ставки в текущей ситуации.\n===1===\nВторой разбор написан чисто и по-русски, без единого изъяна в тексте.",
  ];
  for (const txt of broken) {
    let out;
    const said = await quiet(async () => { out = await withFetch(reply(txt), () => llmComments(evs, panel)); });
    assert.equal(out?.[0] ?? null, null, `ломаный текст не должен доходить до читателя: ${txt.slice(10, 60)}`);
    assert.match(said, /испорчен/, "причина брака обязана быть в логе");
  }
});

testAsync("чистый русский разбор с аббревиатурами и именами проходит", async () => {
  const txt = "===0===\nПотоки в биткоин-ETF развернулись: за неделю отток, MVRV ушёл к 18-му перцентилю, а Nasdaq при этом растёт.\n===1===\nВторой разбор тоже чистый, с упоминанием Deribit и обычных сокращений вроде ФРС и ВВП.";
  const out = await withFetch(reply(txt), () => llmComments(evs, panel));
  assert.ok(out[0] && out[1], `нормальный текст с аббревиатурами не должен браковаться: ${JSON.stringify(out)}`);
});

testAsync("одиночный устоявшийся англицизм модель не меняет", async () => {
  // «treasuries» в боевом прогоне вызвал смену модели — это расточительно: слово читателю
  // понятно, а лишний запрос жжёт бесплатную квоту. Признак срыва языка — ДВА слова подряд.
  const txt = "===0===\nДоходности treasuries подросли, и это давит на длинные ставки по всему рынку сегодня.\n===1===\nВторой разбор чистый и достаточно длинный для проверки языковых правил.";
  const out = await withFetch(reply(txt), () => llmComments(evs, panel));
  assert.ok(out[0], `одно английское слово не повод браковать разбор: ${JSON.stringify(out)}`);
});

testAsync("перегрузка бесплатного провайдера — переход к запасной модели", async () => {
  // Боевой случай: «Upstream error from Nvidia: ResourceExhausted: Worker local total request
  // limit reached (163/32)» оставил уведомление без разбора. Одна модель = единая точка отказа.
  const tried = [];
  const impl = async (_u, o) => {
    const m = JSON.parse(o.body).model;
    tried.push(m);
    if (m.startsWith("nvidia/")) return { ok: true, json: async () => ({ error: { message: "Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached (163/32)" } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "===0===\nразбор от запасной\n===1===\nвторой" } }] }) };
  };
  let out;
  await quiet(async () => { out = await withFetch(impl, () => llmComments(evs, panel)); });
  assert.equal(out[0], "разбор от запасной", "перегрузка одного провайдера не должна лишать разбора");
  assert.ok(tried.length >= 2, `должна быть попытка у следующей модели: ${tried}`);
  assert.ok(!tried[1].startsWith("nvidia/"), `запасная обязана быть у ДРУГОГО провайдера: ${tried}`);
});

testAsync("вся цепочка запасных моделей — бесплатная", async () => {
  const tried = [];
  const impl = async (_u, o) => {
    tried.push(JSON.parse(o.body).model);
    return { ok: true, json: async () => ({ error: { message: "exhausted" } }) };
  };
  await quiet(async () => { await withFetch(impl, () => llmComments(evs, panel)); });
  assert.ok(tried.length >= 3, `цепочка должна быть не из одной модели: ${tried}`);
  for (const m of tried) assert.ok(m.endsWith(":free"), `платная модель в цепочке: ${m}`);
  assert.equal(new Set(tried).size, tried.length, "повторов в цепочке быть не должно");
});

testAsync("явно заданная модель отменяет цепочку", async () => {
  const tried = [];
  const impl = async (_u, o) => {
    tried.push(JSON.parse(o.body).model);
    return { ok: true, json: async () => ({ error: { message: "exhausted" } }) };
  };
  process.env.NOTIFY_MODEL = "google/gemma-4-31b-it:free";
  try {
    await quiet(async () => { await withFetch(impl, () => llmComments(evs, panel)); });
  } finally {
    delete process.env.NOTIFY_MODEL;
  }
  assert.deepEqual(tried, ["google/gemma-4-31b-it:free"], "выбор владельца не подменяется цепочкой");
});

testAsync("тело-ошибка при статусе 200 объясняется в логе", async () => {
  // OpenRouter умеет вернуть 200 с телом-ошибкой и пустым choices; без этой ветки в логе было
  // только «ответ пуст», и причина оставалась невидимой.
  const impl = async () => ({ ok: true, json: async () => ({ error: { message: "rate limit exceeded" } }) });
  let out, said = "";
  said = await quiet(async () => { out = await withFetch(impl, () => llmComments(evs, panel)); });
  assert.equal(out, null);
  assert.match(said, /rate limit exceeded/);
});

testAsync("провайдер, не понявший подавление размышлений, получает повтор без него", async () => {
  const seen = [];
  const impl = async (_u, o) => {
    const body = JSON.parse(o.body);
    seen.push(body.reasoning ? "с подавлением" : "без подавления");
    if (body.reasoning) return { ok: false, status: 400, text: async () => "unsupported parameter" };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "===0===\nразбор\n===1===\nвторой" } }] }) };
  };
  let out;
  await quiet(async () => { out = await withFetch(impl, () => llmComments(evs, panel)); });
  assert.deepEqual(seen, ["с подавлением", "без подавления"], "должен быть ровно один повтор");
  assert.equal(out[0], "разбор", "разбор не теряется из-за неподдержанного параметра");
});

testAsync("отказ параметра телом при коде 200 тоже даёт повтор", async () => {
  // Провайдеры сообщают об отказе по-разному: одни HTTP-кодом, другие полем error при 200.
  const seen = [];
  const impl = async (_u, o) => {
    const body = JSON.parse(o.body);
    seen.push(body.reasoning ? "с подавлением" : "без подавления");
    if (body.reasoning) return { ok: true, json: async () => ({ error: { message: "unsupported parameter: reasoning" } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "===0===\nразбор\n===1===\nвторой" } }] }) };
  };
  let out;
  await quiet(async () => { out = await withFetch(impl, () => llmComments(evs, panel)); });
  assert.deepEqual(seen, ["с подавлением", "без подавления"]);
  assert.equal(out[0], "разбор");
});

testAsync("перегрузка провайдера НЕ путается с отказом параметра", async () => {
  // «ResourceExhausted» — это не про параметры: повторять тот же запрос бессмысленно, надо
  // сразу идти к следующей модели, иначе на каждую перегрузку тратится лишний запрос квоты.
  const seen = [];
  const impl = async (_u, o) => {
    const body = JSON.parse(o.body);
    seen.push(`${body.model}|${body.reasoning ? "подавл" : "без"}`);
    if (body.model.startsWith("nvidia/")) return { ok: true, json: async () => ({ error: { message: "ResourceExhausted: Worker local total request limit reached (163/32)" } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "===0===\nразбор\n===1===\nвторой" } }] }) };
  };
  let out;
  await quiet(async () => { out = await withFetch(impl, () => llmComments(evs, panel)); });
  assert.equal(seen.filter((x) => x.startsWith("nvidia/")).length, 1, `на перегруженную модель — один запрос, а не два: ${seen}`);
  assert.equal(out[0], "разбор");
});

testAsync("бюджет токенов рассчитан на размышления модели", async () => {
  let body = null;
  const spy = async (_u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ choices: [{ message: { content: "===0===\nтекст\n===1===\nтекст" } }] }) }; };
  await withFetch(spy, () => llmComments(evs, panel));
  assert.ok(body.max_tokens >= 8000, `рассуждающей модели нужен запас, а не ${body.max_tokens} токенов`);
  assert.equal(body.reasoning?.exclude, true, "размышления не должны возвращаться в ответе");
});

testAsync("пустой ответ модели объясняется в логе, а не молчит", async () => {
  const impl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "" }, finish_reason: "length" }] }) });
  let out, said = "";
  said = await quiet(async () => { out = await withFetch(impl, () => llmComments(evs, panel)); });
  assert.equal(out, null);
  assert.match(said, /не дал текста/, "иначе «шаблон» в логе не отличить от «модель ответила, а я не разобрал»");
});

testAsync("ответ, обёрнутый в markdown-блок, разбирается", async () => {
  const txt = "```\n===0===\nтекст один\n===1===\nтекст два\n```";
  const out = await withFetch(reply(txt), () => llmComments(evs, panel));
  assert.equal(out[0], "текст один");
});

testAsync("единственное событие принимает связный текст без маркеров", async () => {
  const one = [evs[0]];
  const txt = "Спред расширился на три пункта — движение рядовое, но направление стоит держать в уме: кредитные премии обычно поворачивают раньше акций.";
  const out = await withFetch(reply(txt), () => llmComments(one, panel));
  assert.equal(out[0], txt, "модель, ответившая без разметки на один вопрос, не должна терять ответ");
});

testAsync("пропущенный моделью индекс не ломает рассылку", async () => {
  const out = await withFetch(reply('[{"i":1,"text":"только второй"}]'), () => llmComments(evs, panel));
  assert.equal(out[0], null, "на пропуск подставится шаблон");
  assert.equal(out[1], "только второй");
});

testAsync("нечитаемый ответ → шаблон, с диагностикой в логе", async () => {
  let out, said = "";
  said = await quiet(async () => { out = await withFetch(reply("извините, не могу"), () => llmComments(evs, panel)); });
  assert.equal(out, null);
  assert.match(said, /не разобран/, "в логе должно быть видно, что модель ответила, но ответ не разобрался");
});

testAsync("отказ API не роняет прогон и объясняет причину в логе", async () => {
  let out;
  const said = await quiet(async () => {
    out = await withFetch(async () => ({ ok: false, status: 503, text: async () => "down" }), () => llmComments(evs, panel));
  });
  assert.equal(out, null);
  assert.match(said, /503/, "причина отказа обязана попасть в лог");
});

testAsync("по умолчанию берётся именно бесплатная nemotron", async () => {
  let seen = null;
  const spy = async (_url, opt) => {
    seen = JSON.parse(opt.body).model;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '[{"i":0,"text":"ok"},{"i":1,"text":"ok"}]' } }] }) };
  };
  const realModel = process.env.NOTIFY_MODEL;
  delete process.env.NOTIFY_MODEL;
  try {
    await withFetch(spy, () => llmComments(evs, panel));
  } finally {
    if (realModel !== undefined) process.env.NOTIFY_MODEL = realModel;
  }
  assert.equal(seen, "nvidia/nemotron-3-ultra-550b-a55b:free");
});

testAsync("пустая переменная модели (незаданный vars) не ломает выбор бесплатной", async () => {
  let seen = null;
  const spy = async (_url, opt) => {
    seen = JSON.parse(opt.body).model;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '[{"i":0,"text":"ok"},{"i":1,"text":"ok"}]' } }] }) };
  };
  process.env.NOTIFY_MODEL = "   ";
  try {
    await withFetch(spy, () => llmComments(evs, panel));
  } finally {
    delete process.env.NOTIFY_MODEL;
  }
  assert.equal(seen, "nvidia/nemotron-3-ultra-550b-a55b:free");
});

testAsync("платная модель без явного разрешения не вызывается вообще", async () => {
  let called = false;
  const spy = async () => {
    called = true;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "[]" } }] }) };
  };
  process.env.NOTIFY_MODEL = "anthropic/claude-opus-4.8";
  let out;
  let said = "";
  try {
    said = await quiet(async () => {
      out = await withFetch(spy, () => llmComments(evs, panel));
    });
  } finally {
    delete process.env.NOTIFY_MODEL;
  }
  assert.equal(out, null, "должен быть шаблон, а не запрос");
  assert.equal(called, false, "платный запрос не должен уходить в сеть");
  assert.match(said, /платная/, "отказ от платной модели обязан быть объяснён в логе");
});

testAsync("платная модель уходит в сеть только при NOTIFY_ALLOW_PAID=1", async () => {
  let seen = null;
  const spy = async (_url, opt) => {
    seen = JSON.parse(opt.body).model;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '[{"i":0,"text":"ok"},{"i":1,"text":"ok"}]' } }] }) };
  };
  process.env.NOTIFY_MODEL = "anthropic/claude-opus-4.8";
  process.env.NOTIFY_ALLOW_PAID = "1";
  try {
    await withFetch(spy, () => llmComments(evs, panel));
  } finally {
    delete process.env.NOTIFY_MODEL;
    delete process.env.NOTIFY_ALLOW_PAID;
  }
  assert.equal(seen, "anthropic/claude-opus-4.8");
});

testAsync("без ключа модель не дёргается вовсе", async () => {
  const real = process.env.OPENROUTER_KEY;
  delete process.env.OPENROUTER_KEY;
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; throw new Error("не должно вызываться"); };
  try {
    assert.equal(await llmComments(evs, panel), null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
    if (real !== undefined) process.env.OPENROUTER_KEY = real;
  }
});

for (const [name, fn] of asyncTests) {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`ПРОВАЛ: ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

console.log(`тестов пройдено: ${passed}`);
if (process.exitCode) console.error("ЕСТЬ ПРОВАЛЫ");
