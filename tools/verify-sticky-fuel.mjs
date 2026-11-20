/**
 * §131: КАРТОЧКА ТОПЛИВА ЗАЛИПАЕТ ПОД ШАПКОЙ.
 *
 * Пользователь: «на странице ангар при прокрутке списка карточка „топливо“
 * всегда оставалась наверху… сперва карточка корабля уезжает вверх вместе с
 * остальным списком, затем карточка „топливо“, дойдя до нижнего края шапки,
 * закрепляется там, а остальной список уходит уже под „топливо“».
 *
 * Проверяется:
 *   1. карточка топлива стоит в потоке ПОСЛЕ карточки корабля (значит, пока
 *      список не прокручен, она едет вместе с ним, а не висит сразу);
 *   2. у неё `position: sticky` и `top: 0` — то есть прилипание к верху
 *      области прокрутки, а область прокрутки — это `<main>` под шапкой;
 *   3. она выше остальных карточек по z-index, иначе список шёл бы поверх;
 *   4. карточки топлива нет ни на одной другой вкладке.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const LAVE = 7;
const SAVE_KEY = 'elite-idle-save-v1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const byAction = (w, a, extra = {}) => [...w.document.querySelectorAll(`[data-action="${a}"]`)]
  .find((b) => Object.entries(extra).every(([k, v]) => b.dataset[k] === String(v)));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

function boot(save) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://arena.test/',
    beforeParse(w) {
      w.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
        arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
        measureText: (t) => ({ width: String(t).length * 6 }),
        set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
      });
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      w.cancelAnimationFrame = clearTimeout;
    },
  });
  return dom.window;
}

const state = {
  version: 4, galaxy: 1, system: LAVE, cash: 200_000, fuel: 30, holdSpace: 8,
  cargo: Array(17).fill(0), market: Array(17).fill({ price: 100, quantity: 5 }),
  rng: 1, flight: null,
  ship: { model: 'adder', laser: 'pulse', missiles: 1, ecm: false, energyBomb: false, energyUnit: false, fuelScoops: false, dockingComputer: false, galacticHyperdrive: false, cargoBayExtended: false },
  kills: 128, legal: 0, encounter: null, combat: null, salvage: null,
  pilots: [], nextPilotId: 1, stations: [],
  stats: { kills: 128, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, raided: 0 },
  cargoBasis: Array(17).fill(0), cargoOrigin: [], escapeRoute: [], escapeStatus: -1,
  careerMs: 0, careerAt: 0,
};

const w = boot({ state: JSON.stringify(state), log: [] });
await wait(900);
click(w, byAction(w, 'tab', { tab: 'hangar' }));
await wait(400);

const main = w.document.getElementById('content');
const wrap = main.querySelector('.sticky-fuel');
const fuel = wrap?.querySelector('.card');
check('§131: карточка топлива на месте', fuel !== undefined && fuel !== null);
check('§131: она внутри липкой обёртки', wrap !== null);

/*
 * §131.1: липнет ОБЁРТКА, а не карточка.
 *
 * Пользователь (скриншот): «сверху видно нижние карточки в зазоре между
 * „топливо“ и шапкой». Лечится не координатами, а фоном: обёртка красится
 * цветом страницы и имеет собственный отступ сверху — он и закрывает щель.
 */
const ws = w.getComputedStyle(wrap);
check('§131: position: sticky', ws.position === 'sticky', ws.position);
check('§131: прилипает к верху области прокрутки (top: 0)', ws.top === '0px', ws.top);
check('§131.1: у обёртки есть закрашенный отступ сверху', parseFloat(ws.paddingTop) >= 6, ws.paddingTop);
// §131.3: снизу полотна быть не должно — оно закрывало нижний край карточки.
check('§131.3: снизу у обёртки полотна нет', parseFloat(ws.paddingBottom) === 0, ws.paddingBottom);
check('§131.1: фон обёртки — цвет страницы, а не прозрачность',
  ws.backgroundColor !== '' && ws.backgroundColor !== 'transparent' && ws.backgroundColor !== 'rgba(0, 0, 0, 0)', ws.backgroundColor);
check('§131.1: обёртка выходит в поля main, чтобы закрыть и боковые щели',
  parseFloat(ws.marginLeft) <= -8 && parseFloat(ws.marginRight) <= -8, `${ws.marginLeft} / ${ws.marginRight}`);
check('§131: у самой карточки полей нет — зазор даёт обёртка',
  w.getComputedStyle(fuel).marginTop === '0px' && w.getComputedStyle(fuel).marginLeft === '0px');
check('§131: она выше остальных карточек', Number(ws.zIndex) >= 1, ws.zIndex);

// Порядок: сперва модель корабля, потом топливо, потом всё остальное.
const cards = [...main.querySelectorAll(':scope > .card')];
check('§131: карточка корабля идёт раньше топлива', /корабль в ангаре/.test(cards[0]?.textContent ?? ''));
const order = [...main.children];
check('§131: топливо — после модели корабля', order.indexOf(wrap) === 1, `${order.indexOf(wrap)}`);
check('§131: под топливом остальной список',
  /Оборудование/.test(order[2]?.textContent ?? ''), order[2]?.className);

/*
 * §131.2: главная причина щели — верхний отступ у самой области прокрутки.
 * Sticky выравнивается по её внутреннему краю, и эти 4px оставались дырой
 * над обёрткой: в неё и было видно уползающие строки. Отступа больше нет.
 */
check('§131.2: у области прокрутки нет верхнего отступа',
  w.getComputedStyle(main).paddingTop === '0px', w.getComputedStyle(main).paddingTop);
check('§131.3: у следующей карточки обычное поле — полотно его больше не заменяет',
  w.getComputedStyle(wrap.nextElementSibling).marginTop === '10px',
  w.getComputedStyle(wrap.nextElementSibling).marginTop);

/*
 * §131.8: у прилипшей карточки низ прямой, у едущей — круглый.
 *
 * Пользователь сравнил два вида рядом: «у нас сейчас, как на первом скрине,
 * а надо как на втором». На первом сквозь дугу нижних углов просвечивала
 * карточка под ними. Проверяем оба состояния: rect'ы в jsdom нулевые,
 * поэтому подменяем их и дёргаем настоящую прокрутку.
 */
const rectOf = (top) => ({ top, bottom: top + 100, left: 0, right: 0, width: 100, height: 100, x: 0, y: top });
const place = (wrapTop) => {
  wrap.getBoundingClientRect = () => rectOf(wrapTop);
  main.getBoundingClientRect = () => rectOf(0);
  main.dispatchEvent(new w.Event('scroll'));
};
const radius = () => String(w.getComputedStyle(fuel).borderRadius);
const css = (w.document.querySelector('style')?.textContent ?? '') + html;

place(320);
check('§131.8: пока карточка едет — низ круглый, как у всех', /^16px( 16px){0,3}$/.test(radius()), radius());

place(0);
check('§131.8: залипла — появился класс `stuck`', wrap.classList.contains('stuck'), wrap.className);
check('§131.8: и низ у неё прямой',
  String(w.getComputedStyle(fuel).borderBottomLeftRadius).startsWith('0px') &&
  String(w.getComputedStyle(fuel).borderBottomRightRadius).startsWith('0px'),
  `${w.getComputedStyle(fuel).borderBottomLeftRadius} / ${w.getComputedStyle(fuel).borderBottomRightRadius}`);
check('§131.8: а верх остаётся круглым',
  String(w.getComputedStyle(fuel).borderTopLeftRadius) === '16px', w.getComputedStyle(fuel).borderTopLeftRadius);
check('§131.8: тень осталась у самой карточки',
  String(w.getComputedStyle(fuel).boxShadow).includes('12px'), String(w.getComputedStyle(fuel).boxShadow));
check('§131.8: «подошвы» под карточкой нет', !/\.sticky-fuel\.stuck::?after/.test(css), 'правила нет');

// Прокручивается именно main, а не окно: иначе sticky считался бы от шапки.
check('§131: прокрутка — в main', w.getComputedStyle(main).overflowY === 'auto', w.getComputedStyle(main).overflowY);

// На других вкладках липкой карточки нет.
click(w, byAction(w, 'tab', { tab: 'market' }));
await wait(300);
check('§131: на рынке липкой карточки нет', w.document.querySelectorAll('.sticky-fuel').length === 0);
click(w, byAction(w, 'tab', { tab: 'ship' }));
await wait(300);
check('§131: на экране корабля её тоже нет', w.document.querySelectorAll('.sticky-fuel').length === 0);

w.close();
console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad === 0 ? 0 : 1);
