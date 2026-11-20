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
const fuel = [...main.querySelectorAll('.card')].find((c) => /^Топливо/.test(c.textContent.trim()));
check('§131: карточка топлива на месте', fuel !== undefined);

const style = w.getComputedStyle(fuel);
check('§131: position: sticky', style.position === 'sticky', style.position);
check('§131: прилипает к верху области прокрутки (top: 0)', style.top === '0px', style.top);
check('§131: у неё нулевой верхний отступ — иначе над ней щель', style.marginTop === '0px', style.marginTop);
check('§131: она выше остальных карточек', Number(style.zIndex) >= 1, style.zIndex);

// Порядок: сперва модель корабля, потом топливо, потом всё остальное.
const cards = [...main.querySelectorAll(':scope > .card')];
const fuelIndex = cards.indexOf(fuel);
check('§131: карточка корабля идёт раньше топлива', fuelIndex > 0 && /корабль в ангаре/.test(cards[0].textContent), `${fuelIndex}`);
check('§131: под топливом остальной список', cards.length > fuelIndex + 1 && /Оборудование/.test(cards[fuelIndex + 1].textContent));

// Прокручивается именно main, а не окно: иначе sticky считался бы от шапки.
check('§131: прокрутка — в main', w.getComputedStyle(main).overflowY === 'auto', w.getComputedStyle(main).overflowY);

// На других вкладках липкой карточки нет.
click(w, byAction(w, 'tab', { tab: 'market' }));
await wait(300);
check('§131: на рынке липкой карточки нет', w.document.querySelectorAll('.sticky-card').length === 0);
click(w, byAction(w, 'tab', { tab: 'ship' }));
await wait(300);
check('§131: на экране корабля её тоже нет', w.document.querySelectorAll('.sticky-card').length === 0);

w.close();
console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad === 0 ? 0 : 1);
