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
  if (object.uploaded) headers.set("x-snapshot-uploaded", object.uploaded.toISOString());

  if (!("body" in object) || object.body === null) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}
