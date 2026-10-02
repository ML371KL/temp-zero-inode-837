/**
 * `/ledger.json` — журнал решений (каноническая ступень доли акций) с того же источника, что и страница.
 *
 * Исполняемая ступень зависит от памяти машины ступеней (гистерезис, подтверждение следующей
 * сессией, заморозка апгрейдов). Пока память жила в localStorage, у каждого устройства и у
 * уведомлений ступень была своя. Теперь её ведёт один писатель — прогон уведомлений — и кладёт в
 * ветку `ledger` репозитория (файл ledger.json). Страница читает её отсюда и стартует машину с той
 * же памяти, поэтому сайт, Telegram и все устройства показывают одну ступень.
 *
 * Функция, а не прямой адрес raw.githubusercontent.com: тот же источник, что и у страницы, — ни
 * CORS, ни второго хоста в CSP. Репозиторий задаётся переменной LEDGER_REPO (по умолчанию боевой).
 *
 * Кэш края — около минуты (`cf.cacheTtl`): журнал меняется не чаще такта снимка (20 минут), а
 * страницу открывают чаще; без кэша каждый заход ходил бы в GitHub. Клиенту — no-store: свежесть
 * решает край, а не браузер. Учтите и собственный CDN GitHub (до ~5 минут): после коммита в ветку
 * новая версия доезжает до страницы за минуты, а не мгновенно — для решения раз в сессию это норма.
 *
 * ПЕРЕЖИВАЕТ СБОЙ GITHUB — так же, как functions/snapshot.json.js переживает сбой R2: каждый удачный
 * ответ оставляет копию в кэше края, а на отказ источника (сеть, 5xx, битый JSON) функция отдаёт
 * эту копию, назвав себя в заголовке. Копии нет — честный 503 с Retry-After. Отсутствующий журнал
 * (404: ветку ещё ни разу не записали) копией не маскируется — это настоящее состояние, а не сбой;
 * страница в этом случае ведёт ступень по памяти устройства.
 */

const DEFAULT_REPO = "ML371KL/temp-zero-inode-837";
// Ключ копии — отдельный путь, который никто не запрашивает: под адресом самого `/ledger.json`
// копия могла бы начать отвечать мимо функции, а её долгий срок хранения уехал бы клиенту.
const LAST_GOOD_PATH = "/__ledger-last-good.json";
// Неделя на краю: копия нужна только на время сбоя, но край волен выселить её раньше.
const LAST_GOOD_TTL_SECONDS = 7 * 24 * 3600;
// Кэш края для ответа GitHub: минута — компромисс между свежестью и числом походов в источник.
const UPSTREAM_CACHE_TTL_SECONDS = 60;

function edgeCache() {
  return globalThis.caches?.default ?? null;
}

function lastGoodKey(request) {
  return new Request(new URL(LAST_GOOD_PATH, request.url).toString());
}

async function readLastGood(request) {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    return (await cache.match(lastGoodKey(request))) ?? null;
  } catch {
    return null;
  }
}

function jsonError(status, error, extra = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

// Версия журнала — хэш содержимого: копия переписывается только при новой версии, а не на каждый
// запрос.
async function versionOf(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Возраст журнала — стандартным Last-Modified из его собственного updated_at: по нему видно, что
// писатель встал, даже когда функция исправно отвечает.
function lastModified(ledger) {
  const t = Date.parse(ledger?.updated_at || "");
  return Number.isFinite(t) ? new Date(t).toUTCString() : null;
}

// Источник: текст журнала либо причина отказа. 404 — отдельный исход, а не сбой.
async function fetchUpstream(env) {
  const repo = env?.LEDGER_REPO || DEFAULT_REPO;
  const url = `https://raw.githubusercontent.com/${repo}/ledger/ledger.json`;
  let response;
  try {
    response = await fetch(url, { cf: { cacheTtl: UPSTREAM_CACHE_TTL_SECONDS, cacheEverything: true } });
  } catch (error) {
    return { failure: `сеть: ${error?.message || error}` };
  }
  if (response.status === 404) {
    await response.body?.cancel();
    return { missing: true };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { failure: `GitHub ответил ${response.status}` };
  }
  const text = await response.text();
  // Битый ответ (обрезанный, HTML-заглушка) — сбой источника, а не журнал: странице, которая
  // стартует машину ступеней с этой памяти, нельзя отдавать мусор как данные.
  let ledger;
  try {
    ledger = JSON.parse(text);
  } catch {
    return { failure: "ответ GitHub не является JSON" };
  }
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) return { failure: "журнал не является объектом" };
  return { text, ledger };
}

async function fromLastGood(request, withBody, why) {
  const copy = await readLastGood(request);
  if (!copy) {
    return jsonError(503, "ledger storage is temporarily unavailable", { "retry-after": "30" });
  }
  console.error(`ledger.json: источник недоступен (${why}), отдаю последнюю удачную копию`);
  const headers = new Headers(copy.headers);
  // Долгий срок хранения — свойство копии на краю, клиенту он не положен.
  headers.set("cache-control", "no-store");
  // Копия называет себя: человек, разбирающий сбой, отличит её от свежего ответа.
  headers.set("x-ledger-source", "last-good-copy");
  if (!withBody) {
    await copy.body?.cancel();
    return new Response(null, { status: 200, headers });
  }
  return new Response(copy.body, { status: 200, headers });
}

async function serve(context, { withBody }) {
  const { env, request } = context;
  const got = await fetchUpstream(env);
  if (got.missing) return jsonError(404, "ledger has not been published yet");
  if (got.failure) return fromLastGood(request, withBody, got.failure);

  const version = await versionOf(got.text);
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-ledger-source": "upstream",
    "x-ledger-version": version,
  });
  const modified = lastModified(got.ledger);
  if (modified) headers.set("last-modified", modified);

  const cache = edgeCache();
  if (!cache) {
    headers.set("x-ledger-last-good", "unavailable");
  } else {
    const known = await readLastGood(request);
    const knownVersion = known?.headers.get("x-ledger-version") ?? null;
    await known?.body?.cancel();
    if (knownVersion === version) {
      headers.set("x-ledger-last-good", "fresh");
    } else {
      const copyHeaders = new Headers(headers);
      copyHeaders.set("cache-control", `public, max-age=${LAST_GOOD_TTL_SECONDS}`);
      const stored = cache
        .put(lastGoodKey(request), new Response(got.text, { headers: copyHeaders }))
        .catch((error) => console.error("ledger.json: копия в кэш края не легла", error));
      if (typeof context.waitUntil === "function") context.waitUntil(stored);
      headers.set("x-ledger-last-good", "stored");
    }
  }
  return new Response(withBody ? got.text : null, { status: 200, headers });
}

export async function onRequestGet(context) {
  return serve(context, { withBody: true });
}

// HEAD — тот же GET без тела. Без этого экспорта Pages уходит к статике, а та на неизвестный путь
// отвечает 200 и HTML главной страницы (на этом уже обжёгся сторож свежести у снимка).
export async function onRequestHead(context) {
  const response = await serve(context, { withBody: false });
  return new Response(null, { status: response.status, headers: response.headers });
}
