/**
 * §89: верхняя строка и иконки нижней строки.
 *
 * Проверяем то, что видит игрок и что легко сломать молча:
 *  - в шапке три сегмента: корабль, место, время карьеры;
 *  - кредитов в шапке НЕТ (их место занято), но они есть на «Корабле»;
 *  - в полёте шапка показывает цель, а не станцию вылета;
 *  - иконки нижней строки — SVG, а не эмодзи, и их ровно пять.
 *
 * Эмодзи проверяем по диапазонам Unicode: если кто-то вернёт 🚀, тест
 * скажет об этом строкой, а не «на глаз».
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

// 1. Шапка: три сегмента
const segs = [...d.querySelectorAll('#top-info .top-seg')];
check('в шапке три сегмента', segs.length === 3, String(segs.length));
const keys = segs.map((s) => s.querySelector('.top-key')?.textContent.trim());
check('подписи сегментов', JSON.stringify(keys) === JSON.stringify(['Корабль', 'Карта', 'Журнал']), keys.join(' · '));

// 2. Корабль назван
check('корабль — Cobra Mk III', /Cobra Mk III/.test(flat(d.getElementById('top-info'))), flat(d.getElementById('top-info')));

// 3. Планета нахождения
const place = segs[1]?.querySelector('.top-val')?.textContent.trim() ?? '';
check('карта показывает планету', /^[A-ZА-Я]/.test(place) && place.length > 2, place);

// 4. Время карьеры — не пустое и не «0 с»
const career = segs[2]?.querySelector('.top-val')?.textContent.trim() ?? '';
check('журнал показывает время карьеры', /(< 1 мин|\d+ (мин|ч))/.test(career), career);

// 5. Кредитов в шапке нет
check('кредитов в шапке нет', !/CR/.test(flat(d.getElementById('top-info'))), flat(d.getElementById('top-info')));

// 6. Кредиты есть на «Корабле» (не потеряли деньги с экрана)
const shipTab = [...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'ship');
click(shipTab);
await new Promise((r) => setTimeout(r, 250));
check('кредиты видны на «Корабле»', /Деньги/.test(flat(d.getElementById('content'))) && /CR/.test(flat(d.getElementById('content'))));

// 7. Иконки — SVG, пять штук
const pills = [...d.querySelectorAll('.nav-bar .pill')];
check('иконок пять', pills.length === 5, String(pills.length));
check('все иконки — SVG', pills.every((p) => p.querySelector('svg')), pills.map((p) => (p.querySelector('svg') ? 'svg' : 'нет')).join(','));

// 8. Эмодзи не осталось
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
check('эмодзи в нижней строке нет', !EMOJI.test(d.getElementById('nav').innerHTML));

// 9. SVG наследует цвет (currentColor), а не задаёт свой
const svgs = pills.map((p) => p.querySelector('svg')).filter(Boolean);
check('иконки наследуют цвет', svgs.every((s) => s.getAttribute('stroke') === 'currentColor'),
  svgs.map((s) => s.getAttribute('stroke')).join(','));

// 10. Иконка активной вкладки — внутри `.pill` активной кнопки
const active = d.querySelector('.nav-bar button.active');
check('активная вкладка имеет иконку', !!active?.querySelector('.pill svg'), active?.dataset.tab ?? 'нет');

/*
 * 11. В полёте шапка показывает ЦЕЛЬ, а не станцию вылета.
 *
 * Через интерфейс это не проверить: системы на карте выбираются тапом по
 * канвасу, а тап в jsdom не срабатывает (нет раскладки). Правило живёт в
 * чистой функции `topSegments`, поэтому проверяем её — с настоящим
 * состоянием игры и подложенным полётом.
 */
const core = await import('/home/user/elite-idle/src/core/state.ts');
const { topSegments } = await import('/home/user/elite-idle/src/ui/top-bar.ts');
const base = core.newGame(1);
const flight = topSegments({ ...base, flight: { from: base.system, to: (base.system + 5) % 256, patrol: false } });
const target = core.systemsOf(base.galaxy)[(base.system + 5) % 256].name;
check('в полёте подпись меняется на «Курс»', flight[1].key === 'Курс', flight[1].key);
check('в полёте показана цель', flight[1].value === target, `${flight[1].value} (ждали ${target})`);
const docked = topSegments(base);
check('на стоянке подпись «Карта»', docked[1].key === 'Карта', docked[1].key);
check('на стоянке показана своя система',
  docked[1].value === core.systemsOf(base.galaxy)[base.system].name, docked[1].value);

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
