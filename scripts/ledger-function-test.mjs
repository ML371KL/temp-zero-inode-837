// Функция /ledger.json отдаёт журнал решений (каноническую ступень) с того же источника, что и
// страница, и переживает сбой GitHub.
//
// Функция исполняется на краю Cloudflare, где местный прогон её не увидит, поэтому проверяется
// здесь — с подменными fetch и кэшем края, но с НАСТОЯЩИМ кодом функции. Сломанная функция — это
// страница, которая молча ведёт ступень по памяти устройства, то есть ровно тот разнобой между
// устройствами, ради устранения которого журнал и заведён.
//
// Запускается шагом в site.yml ДО публикации, рядом с тестом функции снимка. Руками:
// node scripts/ledger-function-test.mjs (Node не старше 22.7 — ESM в .js без package.json).

import assert from "node:assert/strict";
import { onRequestGet, onRequestHead } from "../functions/ledger.json.js";

const quiet = console.error;
console.error = () => {};

const PAGE = "https://tzi-837.pages.dev/ledger.json?t=1";
const RAW = "https://raw.githubusercontent.com/ML371KL/temp-zero-inode-837/ledger/ledger.json";
const L1 = JSON.stringify({ v: 1, updated_at: "2026-10-02T12:50:00.000Z", memory: { v: 2, rung: 2, since: "2026-09-30", pend: null, pendSession: null }, transitions: [], diary: [] });
const L2 = JSON.stringify({ v: 1, updated_at: "2026-10-02T13:10:00.000Z", memory: { v: 2, rung: 2, since: "2026-09-30", pend: 1, pendSession: "2026-10-01" }, transitions: [], diary: [] });

function makeCache() {
  const store = new Map();
  const cache = {
    puts: 0,
    async match(request) {
      const hit = store.get(new URL(request.url).pathname);
      return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
    },
    async put(request, response) {
      cache.puts += 1;
      store.set(new URL(request.url).pathname, { body: await response.text(), headers: new Headers(response.headers) });
    },
  };
  return cache;
}

// Подменный GitHub: запоминает, куда и с какими параметрами края его спросили.
let calls = [];
const upstream = (impl) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(url, init);
  };
};
const serves = (text) => upstream(async () => new Response(text, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }));
const status = (code, text = "") => upstream(async () => new Response(text, { status: code }));
const down = () => upstream(async () => { throw new TypeError("fetch failed"); });

async function call(handler, { method = "GET", env = {} } = {}) {
  const pending = [];
  const context = { env, request: new Request(PAGE, { method }), waitUntil: (p) => pending.push(p) };
  const response = await handler(context);
  await Promise.all(pending);
  return response;
}

// Спокойная работа: журнал из ветки ledger, правильные заголовки, кэш края и копия — раз на версию.
{
  const cache = makeCache();
  globalThis.caches = { default: cache };
  calls = [];
  serves(L1);
  const res = await call(onRequestGet);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), L1);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8", "raw.githubusercontent отдаёт text/plain — клиенту нужен JSON");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-ledger-source"), "upstream");
  assert.equal(res.headers.get("last-modified"), new Date("2026-10-02T12:50:00.000Z").toUTCString(), "возраст журнала — из его updated_at");
  assert.equal(res.headers.get("x-ledger-last-good"), "stored");
  assert.equal(calls[0].url, RAW, "по умолчанию — боевой репозиторий, ветка ledger");
  assert.deepEqual(calls[0].init?.cf, { cacheTtl: 60, cacheEverything: true }, "ответ GitHub держится на краю около минуты");
  assert.equal(cache.puts, 1, "удачный ответ обязан оставить копию");

  serves(L1);
  const again = await call(onRequestGet);
  assert.equal(await again.text(), L1);
  assert.equal(again.headers.get("x-ledger-last-good"), "fresh");
  assert.equal(cache.puts, 1, "одна и та же версия переписывала копию на каждом запросе");

  serves(L2);
  assert.equal(await (await call(onRequestGet)).text(), L2);
  assert.equal(cache.puts, 2, "новая версия не попала в копию");
}

// Репозиторий переопределяется переменной окружения.
{
  globalThis.caches = { default: makeCache() };
  calls = [];
  serves(L1);
  await (await call(onRequestGet, { env: { LEDGER_REPO: "someone/fork" } })).text();
  assert.equal(calls[0].url, "https://raw.githubusercontent.com/someone/fork/ledger/ledger.json");
}

// Главное: GitHub лежит (сеть, 5xx, битый ответ), копия есть — страница получает последнюю версию.
for (const [what, fail] of [["сеть", down], ["502", () => status(502, "bad gateway")], ["битый JSON", () => serves("<html>rate limited</html>")], ["не объект", () => serves("null")]]) {
  const cache = makeCache();
  globalThis.caches = { default: cache };
  serves(L1);
  await (await call(onRequestGet)).text();

  fail();
  const res = await call(onRequestGet);
  assert.equal(res.status, 200, `${what}: при живой копии сбой источника не должен превращаться в ошибку`);
  assert.equal(await res.text(), L1, `${what}: отдаётся последняя удачная версия, а не мусор`);
  assert.equal(res.headers.get("x-ledger-source"), "last-good-copy", `${what}: копия обязана назвать себя`);
  assert.equal(res.headers.get("cache-control"), "no-store", `${what}: срок хранения копии не уезжает клиенту`);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(res.headers.get("last-modified"), new Date("2026-10-02T12:50:00.000Z").toUTCString(), `${what}: возраст копии не выдаётся за свежесть`);
  assert.equal(cache.puts, 1, `${what}: сбой не должен переписывать копию`);

  fail();
  const head = await call(onRequestHead, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
}

// GitHub лежит, копии нет — честный 503 с Retry-After, а не сорванный вызов.
{
  globalThis.caches = { default: makeCache() };
  down();
  const res = await call(onRequestGet);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "30");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  assert.match((await res.json()).error, /temporarily unavailable/);
  down();
  assert.equal((await call(onRequestHead, { method: "HEAD" })).status, 503);
}

// Журнала ещё нет (ветку не записали) — настоящее состояние, копия его не маскирует.
{
  globalThis.caches = { default: makeCache() };
  serves(L1);
  await (await call(onRequestGet)).text();
  status(404, "404: Not Found");
  const res = await call(onRequestGet);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match((await res.json()).error, /has not been published/);
}

// HEAD отвечает заголовками без тела.
{
  globalThis.caches = { default: makeCache() };
  serves(L1);
  const head = await call(onRequestHead, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(await head.text(), "");
}

// Кэша нет вовсе (местный прогон или рантайм без Cache API) — работа как прежде, сбой — 503.
{
  delete globalThis.caches;
  serves(L1);
  const res = await call(onRequestGet);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), L1);
  assert.equal(res.headers.get("x-ledger-last-good"), "unavailable");
  down();
  assert.equal((await call(onRequestGet)).status, 503, "без кэша сбой — всё равно честный 503, а не исключение");
}

console.error = quiet;
console.log("Ledger function tests OK");
