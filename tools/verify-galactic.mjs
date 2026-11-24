/**
 * §133.14: ГАЛАКТИЧЕСКИЙ ГИПЕРПРЫЖОК НА КАРТЕ.
 *
 * Пользователь: «перенеси карточку „Галактический гиперпрыжок“ из ангара в
 * карту и добавь в эту карточку кнопку „Активировать“, по нажатию которой эта
 * кнопка становится „Отменить“ и справа появляется таймер на 10 секунд (пока
 * он идёт, можно нажать „Отмена“ и остаться в текущей галактике)».
 *
 * Проверяем то, что видит игрок:
 *   - карточка стоит на карте и её нет в ангаре;
 *   - у кнопки два состояния, таймер тикает справа;
 *   - «Отменить» возвращает кнопку в исходный вид и НЕ меняет галактику;
 *   - если отсчёт доходит до нуля, прыжок случается, двигатель сгорает;
 *   - без двигателя кнопка погашена.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

function boot({ drive }) {
  const state = {
    version: 6, galaxy: 2, system: 3, cash: 200000, fuel: 60, holdSpace: 16,
    cargo: Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'cobra3', laser: 'pulse', missiles: 4, ecm: false, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: drive, cargoBayExtended: false,
    },
    kills: 40, legal: 0, encounter: null, combat: null, salvage: null,
    pilots: [], nextPilotId: 1, stations: [],
    stats: { kills: 40, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, pilotIncome: 0, jumps: 12, dockings: 0, dockingFails: 0, raided: 0, patrols: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [], escapeRoute: [], escapeStatus: -1,
    careerMs: 0, careerAt: 0,
    missions: [], missionOffers: [], missionRep: 0, nextMissionId: 1, missionRng: 1,
    supernova: null, destroyedStations: [], supernovaEndedAt: 0,
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
  return dom;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (dom, tab) => {
  const w = dom.window, d = w.document;
  await wait(900);
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  const btn = [...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === tab);
  btn?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(250);
};
const text = (dom) => dom.window.document.getElementById('content').textContent.replace(/\s+/g, ' ');

/* ---------- 1. Карточка переехала ---------- */
const dom = boot({ drive: true });
const w = dom.window, d = w.document;
await open(dom, 'map');

check('карточка стоит на карте', /Галактический гиперпрыжок/.test(text(dom)));
const arm = d.querySelector('[data-action="galactic-toggle"]');
check('в карточке кнопка «Активировать»', arm?.textContent.trim() === 'Активировать', arm?.textContent.trim() ?? 'нет кнопки');
check('кнопка живая', arm?.disabled === false);
check('таймера пока нет', !d.getElementById('galactic-timer'));

/* ---------- 2. Отсчёт ---------- */
arm.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(350);
const cancel = d.querySelector('[data-action="galactic-toggle"]');
const timer = d.getElementById('galactic-timer');
check('кнопка стала «Отменить»', cancel?.textContent.trim() === 'Отменить', cancel?.textContent.trim() ?? 'нет кнопки');
check('справа появился таймер', !!timer, timer?.textContent ?? '');
check('таймер считает от 10 вниз', /^\d\.\d с$/.test(timer?.textContent ?? '') && parseFloat(timer.textContent) < 10 && parseFloat(timer.textContent) > 8.5, timer?.textContent ?? '');
check('таймер справа от кнопки',
  !!timer && cancel.compareDocumentPosition(timer) === w.Node.DOCUMENT_POSITION_FOLLOWING);
const first = parseFloat(timer.textContent);
await wait(400);
const second = parseFloat(d.getElementById('galactic-timer')?.textContent ?? '0');
check('таймер тикает', second < first, `${first} → ${second}`);

/* ---------- 3. Отмена ---------- */
d.querySelector('[data-action="galactic-toggle"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(250);
check('после отмены снова «Активировать»',
  d.querySelector('[data-action="galactic-toggle"]')?.textContent.trim() === 'Активировать');
check('таймер исчез', !d.getElementById('galactic-timer'));
check('галактика осталась прежней', /Галактика 2/.test(text(dom)));
check('в журнале записана отмена', (() => {
  d.querySelector('[data-action="tab"][data-tab="log"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return /Галактический гиперпрыжок отменён/.test(d.getElementById('content').textContent);
})());
await wait(150);

/* ---------- 4. Отсчёт до нуля ---------- */
d.querySelector('[data-action="tab"][data-tab="map"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(200);
d.querySelector('[data-action="galactic-toggle"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(200);
const realNow = w.Date.now;
w.Date.now = () => realNow() + 11_000;
await wait(400);
w.Date.now = realNow;
check('по нулю таймера прыжок состоялся', /Галактика 3/.test(text(dom)), text(dom).slice(0, 90));
check('кнопка снова «Активировать» и погашена (двигатель сгорел)',
  (() => { const b = d.querySelector('[data-action="galactic-toggle"]'); return b?.textContent.trim() === 'Активировать' && b.disabled; })());
check('в журнале записан прыжок', /Галактический гиперпрыжок: галактика 2 → 3/.test(
  (() => { d.querySelector('[data-action="tab"][data-tab="log"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    return d.getElementById('content').textContent; })()));

/* ---------- 5. В ангаре карточки больше нет ---------- */
const hangar = await (async () => {
  d.querySelector('[data-action="tab"][data-tab="hangar"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(250);
  return text(dom);
})();
check('в ангаре карточки «Галактический гиперпрыжок» нет', !/Галактический гиперпрыжок/.test(hangar));

/* ---------- 6. Без двигателя кнопка погашена ---------- */
const dom2 = boot({ drive: false });
await open(dom2, 'map');
const arm2 = dom2.window.document.querySelector('[data-action="galactic-toggle"]');
check('без двигателя карточка на месте', /Галактический гиперпрыжок/.test(text(dom2)));
check('без двигателя кнопка погашена', arm2?.disabled === true);

console.log(`\n${bad === 0 ? '✅' : '❌'} ${ok}/${ok + bad} проверок §133.14 пройдено`);
process.exit(bad === 0 ? 0 : 1);
