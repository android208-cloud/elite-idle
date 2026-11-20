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
 * §131.10: ОБЁРТКА ПРОЗРАЧНАЯ — НИКАКОЙ ТЁМНОЙ ПОДЛОЖКИ.
 *
 * Пользователь (скриншот): «Карточка остаётся непрозрачным прямоугольником
 * тёмного цвета с нарисованным поверх скруглённым прямоугольником зелёного
 * цвета. Я хотел убрать тёмную подложку, сделав её прозрачной».
 *
 * Обёртка нужна только ради `position: sticky`. Любой её фон, отступ или
 * отрицательное поле — это уже нарисованный прямоугольник вокруг карточки,
 * и именно он просвечивал в дугах нижних углов.
 */
const ws = w.getComputedStyle(wrap);
check('§131: position: sticky', ws.position === 'sticky', ws.position);
check('§131: прилипает к верху области прокрутки (top: 0)', ws.top === '0px', ws.top);
check('§131.10: обёртка ничего не красит — фон прозрачный',
  /rgba\(0, 0, 0, 0\)|transparent/.test(ws.backgroundColor) && ws.backgroundImage === 'none',
  `${ws.backgroundColor} / ${ws.backgroundImage}`);
check('§131.10: у неё нет отступов — иначе вокруг карточки снова была бы рамка',
  parseFloat(ws.paddingTop) === 0 && parseFloat(ws.paddingBottom) === 0 &&
  parseFloat(ws.paddingLeft) === 0 && parseFloat(ws.paddingRight) === 0,
  `${ws.paddingTop} ${ws.paddingRight} ${ws.paddingBottom} ${ws.paddingLeft}`);
check('§131.10: и нет полей, в том числе отрицательных',
  parseFloat(ws.marginTop) === 0 && parseFloat(ws.marginLeft) === 0 && parseFloat(ws.marginRight) === 0,
  `${ws.marginTop} / ${ws.marginLeft} / ${ws.marginRight}`);
check('§131: у самой карточки полей нет — иначе сверху была бы щель',
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
check('§131.10: у следующей карточки обычное поле',
  w.getComputedStyle(wrap.nextElementSibling).marginTop === '10px',
  w.getComputedStyle(wrap.nextElementSibling).marginTop);
// §131.10: обёртка больше не даёт отступ — его снова даёт сама модель корабля.
check('§131.10: у модели корабля нижнее поле вернулось',
  w.getComputedStyle(main.querySelector('.ship-view')).marginBottom === '10px',
  w.getComputedStyle(main.querySelector('.ship-view')).marginBottom);

/*
 * §131.11: у прилипшей карточки гасятся ТОЛЬКО верхние углы.
 *
 * Пользователь: «А сможешь сделать чтобы сверху карточки такого эффекта не
 * было? … (снизу всё идеально!)». Снизу сквозь дуги видно уползающую карточку,
 * и это нравится; сверху карточка висит на шапке, и мелькать там нечему.
 */
const css = (w.document.querySelector('style')?.textContent ?? '') + html;
const rectOf = (top) => ({ top, bottom: top + 100, left: 0, right: 0, width: 100, height: 100, x: 0, y: top });
const place = (wrapTop) => {
  wrap.getBoundingClientRect = () => rectOf(wrapTop);
  main.getBoundingClientRect = () => rectOf(0);
  main.dispatchEvent(new w.Event('scroll'));
};
const topLeft = () => String(w.getComputedStyle(fuel).borderTopLeftRadius);
const bottomLeft = () => String(w.getComputedStyle(fuel).borderBottomLeftRadius);

place(320);
check('§131.9: пока карточка едет — все углы круглые',
  /^16px$/.test(topLeft()) && /^16px$/.test(bottomLeft()), `${topLeft()} / ${bottomLeft()}`);

place(0);
check('§131.11: залипла — класс `stuck` появился', wrap.classList.contains('stuck'), wrap.className);
check('§131.11: верхние углы погашены', topLeft().startsWith('0px'), topLeft());
check('§131.11: а нижние остались круглыми — там «нежный эффект»',
  bottomLeft().startsWith('16px'), bottomLeft());
check('§131.11: тень у карточки на месте',
  String(w.getComputedStyle(fuel).boxShadow).includes('12px'), String(w.getComputedStyle(fuel).boxShadow));
check('§131.10: «подошвы» под карточкой нет', !/\.sticky-fuel\.stuck::?after/.test(css), 'правила нет');
check('§131.10: обёртка по-прежнему ничего не красит',
  !/\.sticky-fuel\s*\{[^}]*background/.test(css), 'фона нет');
// §131.11: узкая полоска подложки только над верхним краем карточки.
const strip = css.match(/\.sticky-fuel\.stuck::?before\s*\{[^}]*\}/)?.[0] ?? '';
check('§131.11: над верхним краем есть узкая полоска подложки', strip !== '', strip ? 'правило найдено' : 'правила нет');
check('§131.11: она выше карточки на пару пикселей и цвета страницы',
  /top:\s*-2px/.test(strip) && /height:\s*2px/.test(strip) && /background:\s*var\(--bg\)/.test(strip), strip.slice(0, 60));

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
