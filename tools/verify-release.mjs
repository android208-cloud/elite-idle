/**
 * §92: проверка РЕЛИЗНОГО файла — того, что уходит на телефон.
 *
 * Отдельно от `verify-standalone`: там проверяется сборка как таковая, а
 * здесь — что именно отдаётся пользователю. На телефоне нельзя открыть
 * консоль, поэтому все типичные поломки должны ловиться тут:
 *
 *  - файл автономен: ни одной внешней ссылки (`http://`, `https://`);
 *  - открывается по `file://` без ошибок (именно так его откроют);
 *  - игра рисуется, есть шапка, пять вкладок, SVG-иконки;
 *  - экран стыковки лежит внутри;
 *  - в файле есть отметка сборки — по ней видно, какая это версия.
 *
 * Путь берётся из аргумента, чтобы скрипт работал и для свежей сборки, и
 * для старых релизов из `releases/`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const arg = process.argv[2];
const path = arg ?? (() => {
  // По умолчанию — самый свежий файл в releases/.
  const dir = '/home/user/elite-idle/releases';
  const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  return `${dir}/${files[files.length - 1]}`;
})();

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const html = readFileSync(path, 'utf8');
check('файл — один HTML', path.endsWith('.html'), path.split('/').pop());

// 1. Автономность: ни одной внешней ссылки.
const external = html.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
check('нет внешних ссылок', external.length === 0, external.slice(0, 3).join(' ') || 'ни одной');
check('нет <link rel="stylesheet">', !/<link[^>]+stylesheet/i.test(html));
check('нет <script src=', !/<script[^>]+src=/i.test(html));

// 2. Отметка сборки
const build = html.match(/<meta name="build" content="([^"]+)"/)?.[1] ?? '';
check('есть отметка сборки', build.length > 0, build);

// 3. Запуск как на телефоне: file://
const errors = [];
const vc = new VirtualConsole().on('jsdomError', (e) => errors.push(String(e)));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///sdcard/Download/elite-idle.html', virtualConsole: vc });
const w = dom.window;
w.HTMLCanvasElement.prototype.getContext = () => ({
  fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
  arc() {}, closePath() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
  setTransform() {}, fillText() {}, measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }), setLineDash() {}, drawImage() {},
  strokeRect() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {}, roundRect() {},
  getImageData: () => ({ data: [] }), putImageData() {}, clip() {}, rect() {},
});
await new Promise((r) => setTimeout(r, 1500));
const d = w.document;

check('открылся по file:// без ошибок', errors.length === 0, errors[0]?.slice(0, 100) ?? 'нет');
check('игра отрисована', (d.getElementById('app')?.textContent ?? '').trim().length > 100);
check('есть шапка', (d.getElementById('top-info')?.textContent ?? '').trim().length > 0, d.getElementById('top-info')?.textContent?.trim());
check('пять вкладок', d.querySelectorAll('.nav-bar button').length === 5);
check('иконки — SVG', d.querySelectorAll('.nav-bar svg').length === 5);
check('экран стыковки внутри', !!d.getElementById('docking-screen-html'));

/*
 * 4. Вкладки переключаются, и шапка следует за ними.
 *
 * Четыре РАЗНЫХ значения, а не пять: «Рынок» и «Ангар» законно показывают
 * одно и то же — кредиты. Это не совпадение и не лень: деньги — главное
 * число обоих экранов. Проверять «пять уникальных» значило бы требовать
 * различия там, где его быть не должно.
 */
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const top = () => d.getElementById('top-info').textContent.trim();
const byTab = {};
for (const name of ['map', 'market', 'hangar', 'log', 'ship']) {
  click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === name));
  await new Promise((r) => setTimeout(r, 100));
  byTab[name] = top();
}
check('шапка следует за вкладкой', new Set(Object.values(byTab)).size === 4,
  Object.entries(byTab).map(([k, v]) => `${k}=${v}`).join(' · '));
check('«Рынок» и «Ангар» — кредиты', /CR$/.test(byTab.market) && byTab.market === byTab.hangar, byTab.market);
check('«Корабль» — название стартового корабля', byTab.ship === 'Adder', byTab.ship);
check('«Карта» — система', byTab.map === 'LAVE' || /^[A-ZА-Я]/.test(byTab.map), byTab.map);

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
