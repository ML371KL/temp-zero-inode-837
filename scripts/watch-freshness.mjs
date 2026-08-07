// Сторож свежести, живущий ВНЕ машины, которая публикует.
//
// На VPS есть свой сторож, и он быстрее: смотрит раз в пять минут и знает подробности,
// которых снаружи не видно. Но он не может сообщить о том, что умер сам вместе с
// машиной, — а это ровно тот отказ, после которого панель молча показывает вчерашние
// цифры. Этот сторож живёт у GitHub и потому переживает падение сервера.
//
// Отсюда и порог: он намеренно втрое мягче местного. Двое сторожей на один отказ —
// это два сообщения об одном и том же; здесь мы говорим только тогда, когда местный
// уже не может.
//
// Память состояния — issue с постоянным заголовком. GitHub Actions не помнит ничего
// между прогонами, а сторож, кричащий каждые два часа, за сутки перестаёт читаться.
// Открытая issue означает «уже сообщили», закрытая — «всё прошло», и сообщения
// уходят только на переходах.

const URL_TO_WATCH = process.env.SNAPSHOT_URL || "https://tzi-837.pages.dev/snapshot.json";
const MAX_AGE_MINUTES = Number(process.env.MAX_AGE_MINUTES || 180);
const CADENCE = process.env.CADENCE_TEXT || "30 мин";
const MARKER = "Снимок 837 не обновляется";
const REPO = process.env.GITHUB_REPOSITORY || "";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const BOT = process.env.ALERT_BOT_TOKEN || "";
const CHAT = process.env.ALERT_CHAT_ID || "";

async function gh(path, init = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${GH_TOKEN}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub ${init.method || "GET"} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function telegram(text) {
  // Отсутствие бота не должно ронять сторожа: issue всё равно заведётся, и сигнал
  // останется хотя бы в репозитории.
  if (!BOT || !CHAT) return void console.log("Telegram не настроен — сообщение пропущено");
  const response = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, parse_mode: "HTML", disable_web_page_preview: true, text }),
  });
  const body = await response.json().catch(() => ({}));
  console.log(body?.ok ? "Telegram: отправлено" : `Telegram: не отправлено — ${JSON.stringify(body).slice(0, 200)}`);
}

/** Возраст опубликованного снимка в минутах — тем же способом, каким его видит браузер. */
async function publishedAgeMinutes() {
  const response = await fetch(URL_TO_WATCH, { method: "HEAD" });
  if (!response.ok) throw new Error(`панель отвечает HTTP ${response.status}`);
  const stamp = response.headers.get("last-modified");
  // Отсутствие заголовка — не «свежо». Это молчание ровно о том факте, который
  // проверяется, и засчитывать его за здоровье значит прятать вставший публикатор.
  if (!stamp) throw new Error("ответ без Last-Modified: возраст публикации установить нечем");
  return (Date.now() - Date.parse(stamp)) / 60000;
}

const openIncident = async () => (await gh(`/issues?state=open&per_page=100`))
  .find((issue) => issue.title.includes(MARKER) && !issue.pull_request);

let age = null;
let failure = null;
try {
  age = await publishedAgeMinutes();
  if (age > MAX_AGE_MINUTES) failure = `последняя публикация ${Math.round(age)} мин назад при такте ${CADENCE}`;
} catch (error) {
  failure = error.message;
}

const existing = await openIncident();

if (failure) {
  const body = [
    `Панель 837 не обновляется: ${failure}.`,
    "",
    `Адрес: ${URL_TO_WATCH}`,
    "Сбор данных живёт на VPS (systemd-таймер `dash-837.timer`). Местный сторож там",
    "проверяет то же самое каждые пять минут и должен был сказать раньше — если он",
    "молчал, вероятно, недоступна сама машина.",
    "",
    "Смотреть: `systemctl status dash-snapshot@837` и `journalctl -u dash-snapshot@837 -n 50`",
    "",
    "Issue закроется сама, как только публикация возобновится.",
  ].join("\n");
  if (!existing) {
    const issue = await gh("/issues", { method: "POST", body: JSON.stringify({ title: `⚠️ ${MARKER}`, body }) });
    await telegram(
      `🔴 <b>837 · данные перестали обновляться</b>\n${failure}.\n`
      + `Панель показывает старые цифры, но выглядит рабочей.\n\n`
      + `Сбор идёт на VPS; местный сторож молчит — возможно, недоступна машина.\n`
      + `Инцидент: ${issue.html_url}`,
    );
  } else {
    console.log(`инцидент уже открыт: #${existing.number} — молчим`);
  }
  console.error(failure);
  process.exit(1);
}

if (existing) {
  await gh(`/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  await telegram(
    `🟢 <b>837 · данные снова обновляются</b>\n`
    + `Свежесть ${Math.round(age)} мин при такте ${CADENCE}. Инцидент #${existing.number} закрыт.`,
  );
}
console.log(`снимок свежий: ${Math.round(age)} мин при пороге ${MAX_AGE_MINUTES}`);
