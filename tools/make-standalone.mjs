/**
 * Сборка автономного HTML — одного файла, который открывается на телефоне
 * без сервера, без сети и без GitHub Pages.
 *
 * Зачем отдельно от `vite build`:
 *  - обычная сборка грузит JS и CSS отдельными файлами, а `file://` их
 *    подтянет, но экран стыковки в iframe с `file://` ведёт себя
 *    по-разному в разных браузерах;
 *  - здесь всё — скрипт, стили и экран стыковки — лежит внутри одного
 *    файла, поэтому открывается двойным щелчком откуда угодно.
 *
 * Как это работает:
 *  1. `vite build` даёт `dist/` — JS одним куском (формат iife, см.
 *     `vite.config.ts`), CSS отдельным файлом.
 *  2. Скрипт кладёт CSS в `<style>`, JS в `<script>`.
 *  3. Мини-игра стыковки подключается иначе: iframe с `srcdoc` и
 *     `sandbox="allow-scripts"`, а мост между игрой и экраном — тот же
 *     протокол `docking-protocol.ts`. Так экран остаётся отдельным
 *     документом (со своим canvas и стилями), но лежит в том же файле.
 *
 * Границы применимости, о которых честно стоит помнить:
 *  - `localStorage` на `file://` в части браузеров недоступен — игра
 *    и экран стыковки это переживают (`try/catch`);
 *  - сохранение прогресса между запусками на `file://` может не работать;
 *  - это сборка для показа, а не для разработки: правки требуют
 *    пересборки.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'standalone/elite-idle.html');

/**
 * Кодирует разметку экрана в base64.
 *
 * Почему не экранирование: внутри `<script>` HTML-сущности **не
 * декодируются** — содержимое читается как сырой текст. Первая версия
 * экранировала `<` в `&lt;`, и экран приезжал в игру в виде текста,
 * а не разметки. В base64 символа `<` нет вовсе, поэтому и закрыть
 * тег раньше времени невозможно.
 */
function toBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

/**
 * Готовит JSON для вставки внутрь `<script>`.
 *
 * Обычного экранирования мало: подстрока `</script>` внутри строки
 * закрыла бы тег раньше времени, даже если она в кавычках.
 */
function escapeForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

const read = (path) => readFileSync(path, 'utf8');

// --- что и откуда берём -------------------------------------------------

const sourceHtml = read(resolve(root, 'index.html'));
const builtHtml = read(resolve(dist, 'index.html'));

/**
 * Разметка берётся из `index.html`, а не пишется заново.
 *
 * Именно на этом я один раз обжёгся: собрал `<body>` с нуля, потерял
 * `#app` и получил пустой экран при формально успешной сборке. Теперь
 * источник один — тот же файл, что открывает dev-сервер, поэтому
 * разметка не может разойтись.
 */
const bodyInner = sourceHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1];
if (!bodyInner || !bodyInner.includes('id="app"')) {
  throw new Error('В index.html не нашёл <body> с #app — сборка остановлена');
}
// Убираем тег скрипта разработки: код вставим сами.
const bodyMarkup = bodyInner.replace(/\s*<script[^>]*src="[^"]*"[^>]*>\s*<\/script>\s*/g, '\n').trim();
const jsPath = builtHtml.match(/src="\.?\/?(assets\/[^"]+\.js)"/)?.[1];
const cssPath = builtHtml.match(/href="\.?\/?(assets\/[^"]+\.css)"/)?.[1];

if (!jsPath) {
  throw new Error('Не нашёл JS в dist/index.html — сначала выполните `npm run build`');
}

const js = read(resolve(dist, jsPath));
const css = cssPath ? read(resolve(dist, cssPath)) : '';
const docking = read(resolve(root, 'public/user-docking3-tune.html'));

// --- проверка, что в JS нет динамических загрузок -----------------------
//
// Если Vite когда-нибудь начнёт резать бандл на части, автономный файл
// молча перестанет работать: часть кода будет лежать в соседнем файле.
// Лучше упасть на сборке, чем отдать пользователю битый файл.

if (/import\s*\(/.test(js)) {
  throw new Error(
    'В бандле есть динамический import() — автономный файл его не подхватит. ' +
      'Проверьте `build.rollupOptions.output.inlineDynamicImports`.',
  );
}

// --- страница -----------------------------------------------------------

const page = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#05080a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">
<title>Elite Idle</title>
<style>
${css}
</style>
</head>
<body>
${bodyMarkup}
<!--
  Экран стыковки лежит здесь же, но отдельным документом: игра создаёт
  iframe с srcdoc из этого шаблона. Так у экрана остаются свой canvas,
  свои стили и своя разметка — ровно как у отдельного файла.
-->
<script type="text/plain" id="docking-screen-html">${toBase64(docking)}</script>
<script>
${js}
</script>
</body>
</html>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page, 'utf8');

const kb = (text) => (Buffer.byteLength(text) / 1024).toFixed(0);
console.log(`✅ ${out}`);
console.log(`   ${kb(page)} КБ · игра ${kb(js)} КБ · стыковка ${kb(docking)} КБ`);
