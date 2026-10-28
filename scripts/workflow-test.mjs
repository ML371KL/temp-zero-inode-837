// Инварианты notify.yml (аудит ботов 28.10.2026, C4; та же схема, что в 838 — scripts/workflow-test.mjs).
// Сторожит то, что ломается молча: единый actions/cache сохранял состояние уведомлений только при
// успешном прогоне, и падение посреди рассылки (ошибка Telegram, тайм-аут) теряло индекс доставленного
// и суточный расход на разбор — следующий прогон слал ушедшие сообщения заново.
// Регулярки заякорены на начало строки: незаякоренную удовлетворил бы закомментированный шаг, а
// порядок шагов сравнивается по позициям заякоренных совпадений, а не по indexOf в тексте.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const y = readFileSync(new URL("../.github/workflows/notify.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const RESTORE = /^\s*uses:\s*actions\/cache\/restore@v5\s*$/m;
const SAVE = /^\s*if:\s*always\(\)\s*&&\s*hashFiles\('\.notify\/state\.json'\)\s*!=\s*''\s*\n\s*uses:\s*actions\/cache\/save@v5\s*$/m;
const SEND = /^\s*run:\s*node scripts\/notify\.mjs\s*$/m;

assert.doesNotMatch(y, /^\s*uses:\s*actions\/cache@v\d/m, "единый actions/cache сохраняет файл только при успехе: упавший прогон терял индекс доставленного");
const restoreAt = y.match(RESTORE);
const saveAt = y.match(SAVE);
const sendAt = y.match(SEND);
assert.ok(restoreAt, "состояние уведомлений восстанавливается отдельным шагом actions/cache/restore");
assert.ok(saveAt, "состояние уведомлений сохраняется отдельным шагом actions/cache/save при любом исходе рассылки (always())");
assert.ok(sendAt, "шаг рассылки (node scripts/notify.mjs) пропал из notify.yml");
assert.ok(restoreAt.index < sendAt.index, "восстановление состояния обязано стоять до рассылки");
assert.ok(sendAt.index < saveAt.index, "сохранение состояния обязано стоять после рассылки");

// Оба шага смотрят на один и тот же файл и один и тот же ключ; ключ несёт номер попытки, иначе
// «Re-run jobs» упирается в уже занятый ключ и остаётся без сохранения. Префикс restore-keys
// подхватывает последнее сохранённое состояние, включая ключи прежнего вида (без номера попытки).
const block = (at) => y.slice(at.index, at.index + 600).split(/\n\s*- (?:name|uses):/)[0];
const KEY = "razlom26-notify-${{ github.ref_name }}-${{ github.run_id }}-${{ github.run_attempt }}";
for (const [name, at] of [["восстановление", restoreAt], ["сохранение", saveAt]]) {
  const b = block(at);
  assert.match(b, /^\s*path:\s*\.notify\/state\.json\s*$/m, `${name}: путь состояния — .notify/state.json`);
  assert.ok(b.split("\n").some((line) => line.trim() === `key: ${KEY}`), `${name}: ключ обязан быть ${KEY}`);
}
assert.ok(block(restoreAt).split("\n").some((line) => line.trim() === "razlom26-notify-${{ github.ref_name }}-"), "restore-keys: префикс razlom26-notify-<ветка>- подхватывает последнее сохранённое состояние");

// Скрипт обязан класть состояние именно туда, откуда его сохраняет кэш.
assert.match(y, /^\s*NOTIFY_STATE:\s*\.notify\/state\.json\s*$/m, "NOTIFY_STATE должен совпадать с путём кэша");

// Красные тесты не глушат ни рассылку, ни журнал решений (аудит ботов 28.10.2026, C5; та же схема, что в 838).
// Раньше тест-шаг блокировал весь прогон: и сообщения о доле, и единственного писателя ветки ledger.
{
  const TESTS = /^\s*- name:\s*Тесты уведомлений\s*\n\s*id:\s*selftest\s*\n\s*continue-on-error:\s*true\s*\n\s*run:\s*\|\s*\n\s*node scripts\/notify-test\.mjs\s*$/m;
  const RED = /^\s*- name:\s*Красный прогон при упавших тестах\s*\n\s*if:\s*always\(\)\s*&&\s*steps\.selftest\.outcome\s*==\s*'failure'\s*\n[\s\S]*?^\s*exit 1\s*$/m;
  const LEDGER = /^\s*- name:\s*Записать журнал решений в ветку ledger\s*\n\s*if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}\s*$/m;
  const testsAt = y.match(TESTS), redAt = y.match(RED), ledgerAt = y.match(LEDGER);
  assert.ok(testsAt, "тесты уведомлений: шаг с id selftest и continue-on-error — красный тест не должен останавливать рассылку");
  assert.ok(testsAt.index < sendAt.index, "тесты обязаны идти до рассылки: их исход включает осторожный режим");
  assert.match(y, /^\s*NOTIFY_SELFTEST:\s*\$\{\{\s*steps\.selftest\.outcome\s*\}\}\s*$/m, "исход тестов обязан доходить до скрипта: по нему включается осторожный режим");
  assert.ok(ledgerAt, "журнал решений пишется при любом исходе рассылки, кроме отмены (!cancelled())");
  assert.ok(redAt, "упавший тест обязан красить прогон отдельным шагом с always()");
  for (const [name, at] of [["рассылки", sendAt], ["сохранения состояния", saveAt], ["записи журнала", ledgerAt]]) {
    assert.ok(at.index < redAt.index, `красный шаг обязан стоять после ${name}: иначе красный тест снова глушил бы её`);
  }
  // ни один шаг до рассылки и журнала не должен валить прогон из-за тестов
  assert.doesNotMatch(y.slice(0, sendAt.index), /steps\.selftest\.outcome\s*==\s*'failure'[\s\S]*?exit 1/, "проверка исхода тестов с exit 1 до рассылки снова заблокировала бы её");
}

console.log("notify.yml: инварианты состояния уведомлений соблюдены");
