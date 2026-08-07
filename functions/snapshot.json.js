/**
 * `/snapshot.json` — снимок отдаётся из R2, а не из публикации сайта.
 *
 * Панель обновляется четыре раза в час, её код — раз в несколько дней. Пока снимок
 * был файлом внутри сайта, каждое обновление данных пересобирало сайт целиком: около
 * ста сборок GitHub Pages в сутки, и 6 августа, когда очередь Pages встала, страница
 * несколько часов показывала данные, которые давно лежали в репозитории. Теперь эти
 * две частоты развязаны: сайт публикуется при изменении кода, снимок переписывается
 * в бакете и стоит один PUT.
 *
 * Функция, а не публичный адрес бакета: `r2.dev` у Cloudflare ограничен по частоте и
 * в документации назван путём для разработки. Здесь данные приходят с того же
 * источника, что и страница, — значит ни CORS, ни второго хоста в CSP.
 *
 * Путь совпадает со старым намеренно: страница как забирала `./snapshot.json`, так и
 * забирает.
 */

import { bodilessStatus } from "../lib/conditional-requests.js";

export async function onRequestGet({ env, request }) {
  // `onlyIf` перекладывает сверку ETag на R2: если у клиента уже есть текущая версия,
  // тело не читается и не оплачивается.
  const object = await env.DATA.get("snapshot.json", { onlyIf: request.headers });

  if (object === null) {
    // Бакет пуст — это «сборщик ещё ни разу не опубликовал», а не ошибка страницы.
    // Без явного JSON фронтенд получил бы HTML-заглушку 404 и упал на разборе,
    // сообщив совсем не то, что случилось.
    return new Response(
      JSON.stringify({ error: "snapshot has not been published to R2 yet" }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-type", "application/json; charset=utf-8");
  // Снимок переписывается чаще, чем истёк бы любой разумный кэш, и страница уже
  // добавляет к запросу метку времени.
  headers.set("cache-control", "no-store");
  // Last-Modified, а не только собственный заголовок. Это стандартный признак возраста
  // публикации, и его отсутствие — не мелочь: канарейка 839 определяет по нему, не встал ли
  // публикатор, и без него отказывается выносить вердикт вовсе, чтобы остановившаяся
  // публикация не пряталась за неполным заголовком. `writeHttpMetadata` его не пишет — она
  // переносит только httpMetadata объекта, а время выгрузки лежит отдельным полем.
  if (object.uploaded) {
    headers.set("x-snapshot-uploaded", object.uploaded.toISOString());
    headers.set("last-modified", object.uploaded.toUTCString());
  }

  if (!("body" in object) || object.body === null) {
    // 304 говорит «твоя копия актуальна». Клиенту, пришедшему с If-Match, эта фраза
    // не подходит: копии у него нет, а условие не выполнено — это 412. См. модуль.
    return new Response(null, { status: bodilessStatus(request, object), headers });
  }
  return new Response(object.body, { headers });
}

// HEAD — это GET без тела, и обслуживать его обязана та же функция. Без этого экспорта
// Pages не находит обработчика на метод и уходит к статике, а та на неизвестный путь
// отвечает 200 и HTML главной страницы. Сторож свежести, спрашивающий Last-Modified
// именно методом HEAD, получал заглушку и объявлял живую панель мёртвой — проверено
// на себе в первый же прогон.
export async function onRequestHead(context) {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
}
