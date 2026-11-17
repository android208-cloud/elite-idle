/**
 * §91: шапка — заголовок слева, ОДНО значение справа, без подписи.
 *
 * История: §89 свёл всё в три колонки, §90 сделал пару «подпись : значение»,
 * и на экране получилось «Корабль» слева и «КОРАБЛЬ» справа — одно и то же
 * дважды. §91 убрал подпись: заголовок уже говорит, где вы, а справа —
 * что здесь важно.
 *
 * Проверяем по вкладкам, и на каждой — что значение верное и что оно НЕ
 * дублирует заголовок. Плюс кегль: пользователь попросил, чтобы шрифт
 * значения был того же размера, что у слова слева.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://localhost/' });
const w = dom.window;
await new Promise((r) => w.addEventListener('load', r, { once: true }));
await new Promise((r) => setTimeout(r, 400));
const d = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const flat = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const info = () => flat(d.getElementById('top-info'));
const title = () => flat(d.getElementById('title'));
const go = async (name) => {
  click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === name));
  await new Promise((r) => setTimeout(r, 250));
};

// 1. Ни подписей, ни нескольких блоков — только текст
check('в шапке нет подписи-надзаголовка', d.querySelectorAll('#top-info .top-key, #top-info .top-seg').length === 0,
  String(d.querySelectorAll('#top-info .top-key, #top-info .top-seg').length));
check('шапка не пустая', info().length > 0, info());

// 2. Значение не дублирует заголовок слева
for (const tab of ['ship', 'map', 'market', 'hangar', 'log']) {
  await go(tab);
  const t = title().toLowerCase();
  const v = info().toLowerCase();
  check(`«${title()}»: значение не повторяет заголовок`, v !== t && v !== t + ' ', `заголовок «${title()}», справа «${info()}»`);
}

// 3. Корабль — название
await go('ship');
check('«Корабль»: Cobra Mk III', info() === 'Cobra Mk III', info());
check('«Корабль»: кредитов в шапке нет', !/CR/.test(info()), info());
check('«Корабль»: деньги есть в карточке', /Деньги/.test(flat(d.getElementById('content'))));

// 4. Рынок и ангар — кредиты
await go('market');
check('«Рынок»: кредиты', /^\d+\.\d CR$/.test(info()), info());
check('«Рынок»: имени корабля нет', !/Cobra/.test(info()), info());
await go('hangar');
check('«Ангар»: кредиты', /^\d+\.\d CR$/.test(info()), info());

// 5. Карта — место
await go('map');
check('«Карта»: система', /^[A-ZА-Я]/.test(info()) && info().length > 2, info());
check('«Карта»: кредитов нет', !/CR/.test(info()), info());

// 6. Журнал — время карьеры
await go('log');
check('«Журнал»: время карьеры', /(< 1 мин|\d+ (мин|ч))/.test(info()), info());

// 7. Кегль значения = кеглю заголовка (просьба пользователя)
const fs = (el) => w.getComputedStyle(el).fontSize;
check('кегль шапки равен кеглю заголовка', fs(d.getElementById('top-info')) === fs(d.getElementById('title')),
  `${fs(d.getElementById('top-info'))} против ${fs(d.getElementById('title'))}`);
check('кегль — 22px', fs(d.getElementById('top-info')) === '22px', fs(d.getElementById('top-info')));

// 8. Иконки нижней строки
const pills = [...d.querySelectorAll('.nav-bar .pill')];
check('иконок пять', pills.length === 5, String(pills.length));
check('все иконки — SVG', pills.every((p) => p.querySelector('svg')));
check('иконки наследуют цвет', pills.every((p) => p.querySelector('svg')?.getAttribute('stroke') === 'currentColor'));
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
check('эмодзи в нижней строке нет', !EMOJI.test(d.getElementById('nav').innerHTML));

// 9. В полёте — цель (чистая функция: тап по канвасу в jsdom не работает)
const core = await import('/home/user/elite-idle/src/core/state.ts');
const { topValue } = await import('/home/user/elite-idle/src/ui/top-bar.ts');
const base = core.newGame(1);
const to = (base.system + 5) % 256;
const target = core.systemsOf(base.galaxy)[to].name;
check('в полёте показана цель',
  topValue({ ...base, flight: { from: base.system, to, patrol: false } }, 'map') === target, target);

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
