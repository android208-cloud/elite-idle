/**
 * §133.5: ТЕКСТЫ ЭКРАНОВ, ВНЕДРЁННЫЕ ИЗ РЕДАКТОРА.
 *
 * Пользователь присылает файл правок редактора (`elite-idle-ui.json`), и
 * правки переезжают в код. Их легко потерять при следующей переделке экрана —
 * и никто не заметит, потому что на игру это не влияет. Поэтому здесь стоят
 * простые проверки «так написано»:
 *
 *   - «Корабль»: заголовок карточки «Станция LAVE», а не «На станции LAVE»;
 *   - «Корабль»: карточка «Оснащение корабля», а не «Оборудование»;
 *   - «Корабль»: карточка «Груз в трюме», а не «Груз»;
 *   - «Карта»: подсказка «Доступный радиус прыжка»;
 *   - «Ангар»: у карточек топлива и верфи задана минимальная высота из
 *     редактора (140 и 150) — именно `min-height`, а не `height`.
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
const state = {
  version: 5, galaxy: 1, system: LAVE, cash: 200000, fuel: 20, holdSpace: 8,
  cargo: Array(17).fill(0), market: Array(17).fill({ price: 100, quantity: 5 }),
  rng: 1, flight: null,
  ship: {
    model: 'cobra3', laser: 'pulse', missiles: 3, ecm: false, energyBomb: false,
    energyUnit: false, fuelScoops: false, dockingComputer: false,
    galacticHyperdrive: false, cargoBayExtended: false,
  },
  kills: 128, legal: 0, encounter: null, combat: null, salvage: null,
  pilots: [], nextPilotId: 1, stations: [],
  stats: { kills: 128, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, pilotIncome: 0 },
  cargoBasis: Array(17).fill(0), cargoOrigin: [], escapeRoute: [], escapeStatus: -1,
  careerMs: 0, careerAt: 0,
};

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/',
  virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    w.localStorage.setItem('elite-idle-save-v1', JSON.stringify({ state: JSON.stringify(state), log: [] }));
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

const w = dom.window;
const d = w.document;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const tab = (id) => [...d.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === id);
const titles = () => [...d.querySelectorAll('#content .card h2')].map((h) => h.textContent.trim());
const text = () => d.getElementById('content').textContent.replace(/\s+/g, ' ');

await wait(900);

/* ---------- Корабль ---------- */
click(tab('ship'));
await wait(300);
check('«Станция LAVE», а не «На станции LAVE»',
  titles().includes(`Станция ${'LAVE'}`) && !/На станции LAVE/.test(text()),
  titles().join(' · '));
check('карточка называется «Оснащение корабля»', titles().includes('Оснащение корабля'), titles().join(' · '));
check('и «Оборудование» на экране «Корабль» больше нет', !titles().includes('Оборудование'), titles().join(' · '));
check('карточка называется «Груз в трюме»', titles().includes('Груз в трюме'), titles().join(' · '));

/* ---------- Карта ---------- */
click(tab('map'));
await wait(300);
const hint = d.getElementById('local-hint')?.textContent ?? '';
check('на карте — «Доступный радиус прыжка»', /Доступный радиус прыжка/.test(hint), hint);
check('и старой подписи про «текущее топливо» нет', !/по текущему топливу/.test(text()));

/* ---------- Ангар: минимальные высоты из редактора ---------- */
click(tab('hangar'));
await wait(300);
const fuel = [...d.querySelectorAll('#content .card')].find((c) => c.querySelector('h2')?.textContent.trim() === 'Топливо');
const yard = [...d.querySelectorAll('#content .card')].find((c) => c.querySelector('h2')?.textContent.trim() === 'Верфь');
check('у карточки топлива минимальная высота 140', fuel?.style.minHeight === '140px', fuel?.style.minHeight);
check('у верфи минимальная высота 150', yard?.style.minHeight === '150px', yard?.style.minHeight);
check('и это именно min-height, а не жёсткая высота',
  !fuel?.style.height && !yard?.style.height, `${fuel?.style.height} / ${yard?.style.height}`);
check('кнопки топлива опущены на 6 — отступом, а не сдвигом',
  fuel?.querySelector('.row')?.style.marginTop === '6px',
  fuel?.querySelector('.row')?.style.marginTop);

console.log(`\n${ok}/${ok + bad} проверок §133.5 пройдено`);
process.exit(bad === 0 ? 0 : 1);
