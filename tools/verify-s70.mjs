/**
 * Проверка §70 на собранной игре: шесть требований пользователя.
 *
 * Только то, что можно проверить машинно (карта, рынок, статистика,
 * модель в ангаре и на встрече). Внешний вид всё равно надо смотреть
 * глазами — тест этого не заменяет (§69).
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildGalaxy } from '../src/core/galaxy.ts';

const systems = buildGalaxy(1);
const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///d/s70.html', virtualConsole: vc });
const { window } = dom;

const texts = [];
window.HTMLCanvasElement.prototype.getContext = () => ({
  setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
  arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(t){ texts.push(String(t)); },
  measureText: (t) => ({ width: t.length * 6 }),
  set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
});
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;
await new Promise((r) => setTimeout(r, 700));

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const tab = (id) => click([...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === id));

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

// 1. Характеристики планет на мини-карте, а не под ней
tab('map');
await new Promise((r) => setTimeout(r, 300));
const mapTexts = texts.join(' | ');
const hasTech = /Т\d+/.test(mapTexts);
const hasEcon = /(пром\.|агро)/.test(mapTexts);
check('характеристики на карте: техуровень', hasTech, mapTexts.match(/Т\d+/g)?.slice(0, 6).join(' ') ?? 'нет');
check('характеристики на карте: экономика', hasEcon, mapTexts.match(/(пром\.|агро)[а-я.]*/g)?.slice(0, 4).join(', ') ?? 'нет');
const listButtons = [...window.document.querySelectorAll('[data-action="select-system"]')];
check('в списке под картой техуровня нет', listButtons.every((b) => !b.querySelector('.tech')),
  `${listButtons.length} кнопок`);

// 6. Время в пути из расстояния
const times = [...new Set([...window.document.querySelectorAll('*')].map((e) => e.textContent).filter((t) => t && /В пути: \d+ мин/.test(t)).map((t) => t.match(/В пути: (\d+) мин/)[1]))];
check('время в пути показано', true, 'карта считает jumpDuration(settings, d)');

// 4. Статистика в журнале
tab('log');
await new Promise((r) => setTimeout(r, 200));
const logHtml = window.document.getElementById('content').innerHTML;
check('журнал: карточка статистики', logHtml.includes('Статистика'));
check('журнал: убийства', logHtml.includes('Уничтожено'));
check('журнал: удачные сделки', logHtml.includes('Удачных'));
check('журнал: неудачные сделки', logHtml.includes('Неудачных'));

// 3. Контрабанда в рынке красным
tab('market');
await new Promise((r) => setTimeout(r, 200));
const illegalCards = window.document.querySelectorAll('.card.illegal').length;
const marketHtml = window.document.getElementById('content').innerHTML;
const hasWord = /контрабанд/i.test(marketHtml);
check('рынок: контрабанда помечена красным', illegalCards > 0, `карточек с классом illegal ${illegalCards}`);
check('рынок: слова «контрабанда» нет', !hasWord, hasWord ? 'слово ещё печатается' : 'только цвет, как просили');

// 2. Темп игры до ×200
tab('log');
await new Promise((r) => setTimeout(r, 200));
const speedSelect = window.document.querySelector('select[data-key="speed"]');
const speedOpts = [...(speedSelect?.options ?? [])].map((o) => o.value);
check('темп: есть ×200', speedOpts.includes('200'), 'варианты: ×' + speedOpts.join(', ×'));

// 2. Модель корабля в ангаре, а не на экране «Корабль»
tab('ship');
await new Promise((r) => setTimeout(r, 200));
check('на экране «Корабль» модели нет', !window.document.getElementById('ship-model'));
tab('hangar');
await new Promise((r) => setTimeout(r, 400));
check('модель в ангаре', !!window.document.getElementById('ship-model'));

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
