/**
 * §133.6: «СВЕРХНОВАЯ» — ЭКРАН.
 *
 * Ядро проверяет `test/supernova.test.ts`. Здесь — то, что видит игрок:
 *
 *   - во время события на «Рынке» появляется карточка «Сверхновая» и одна
 *     кнопка — «Взять беженцев»;
 *   - торговать, заправляться и брать контракты на этой станции нельзя;
 *   - после нажатия трюм занят целиком, кнопка гаснет;
 *   - без события всё работает как обычно — карточки нет, кнопки живые.
 *
 * Событие кладём прямо в сейв: путь «прыжок → прибытие → старт» проверен в
 * ядре, а гонять в jsdom прыжки незачем.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const HOUR = 3_600_000;
const NOW = Date.now();

function boot({ supernova }) {
  const state = {
    version: 6, galaxy: 2, system: 3, cash: 200000, fuel: 60, holdSpace: 8,
    cargo: Array(17).fill(0), market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'cobra3', laser: 'pulse', missiles: 4, ecm: false, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: true, cargoBayExtended: false,
    },
    kills: 600, legal: 0, encounter: null, combat: null, salvage: null,
    pilots: [], nextPilotId: 1, stations: [],
    stats: { kills: 600, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, pilotIncome: 0, jumps: 40, dockings: 0, dockingFails: 0, raided: 0, patrols: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [], escapeRoute: [], escapeStatus: -1,
    careerMs: 0, careerAt: 0,
    missions: [], missionOffers: [], missionRep: 0, nextMissionId: 1, missionRng: 1,
    supernova, destroyedStations: [], supernovaEndedAt: 0,
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

const event = {
  galaxy: 2, system: 3, startedAt: NOW - 60000, at: NOW + 3 * HOUR,
  leakedTo: NOW - 60000, maydayAt: NOW + HOUR, maydays: 0, refugees: false, escaped: false,
};

/* ---------- Событие идёт ---------- */
const dom = boot({ supernova: event });
const w = dom.window;
const d = w.document;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const text = () => d.getElementById('content').textContent.replace(/\s+/g, ' ');
await wait(900);
// Игра открывается на «Корабле» — идём туда, где живёт событие.
click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'market'));
await wait(300);

check('на «Рынке» одна карточка — «Беженцы»', /Беженцы/.test(text()), text().slice(0, 130));
check('и цена у неё 0.0 CR', /0\.0 CR/.test(text()));
check('из товаров на станции не осталось ничего',
  d.querySelectorAll('#content [data-action="buy1"], #content [data-action="sell1"]').length === 0,
  `${d.querySelectorAll('#content [data-action="buy1"]').length} карточек с покупкой`);
check('есть кнопка «Макс.»', !!d.querySelector('[data-action="refugees"]'),
  d.querySelector('[data-action="refugees"]')?.textContent?.trim() ?? '');
check('«Купить станцию» неактивна', d.querySelector('[data-action="station-buy"]')?.disabled === true);
check('контракты на этой станции закрыты', d.querySelector('[data-action="contracts-open"]')?.disabled === true);

/* ---------- Ангар: только корабль и топливо ---------- */
click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'hangar'));
await wait(300);
const hangar = text();
check('в ангаре осталась карточка «Топливо»', /Топливо/.test(hangar));
check('и модель корабля', !!d.querySelector('#ship-model') || /пристыкован/.test(hangar));
check('вместо кнопок — «Топлива на станции не осталось»',
  /Топлива на станции не осталось/.test(hangar));
check('кнопок заправки нет', d.querySelectorAll('#content [data-action="refuel"]').length === 0);
check('оборудования и верфи в ангаре нет',
  !/Оборудование/.test(hangar) && !/Верфь/.test(hangar));

/* ---------- Возвращаемся и берём всех ---------- */
click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'market'));
await wait(300);
click(d.querySelector('[data-action="refugees"]'));
await wait(300);
const after = text();
check('после «Макс.» трюм занят целиком', /Трюм 0 из 20/.test(after), after.match(/Трюм[^·]*/)?.[0] ?? '');
const maxBtn = d.querySelector('[data-action="refugees"]');
check('кнопка «Макс.» погасла', maxBtn?.disabled === true);
check('и появилась подпись «уже на борту»', /уже на борту/.test(after));
click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'log'));
await wait(250);
const journal = d.getElementById('content')?.textContent ?? '';
check('журнал записал посадку беженцев', /Беженцы на борту: 20 т/.test(journal),
  journal.replace(/\s+/g, ' ').slice(0, 120));
w.close();

/* ---------- Без события всё по-старому ---------- */
const plain = boot({ supernova: null });
const w2 = plain.window;
const d2 = w2.document;
await wait(900);
w2.document.querySelector('[data-action="tab"][data-tab="market"]')
  .dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
await wait(300);
const text2 = () => d2.getElementById('content').textContent.replace(/\s+/g, ' ');
check('без события карточки «Сверхновая» нет', !text2().includes('Сверхновая'));
const buy2 = [...d2.querySelectorAll('#content [data-action="buy1"]')];
check('и торговля живая', buy2.length > 0 && buy2.some((b) => !b.disabled));
w2.close();

console.log(`\n${ok}/${ok + bad} проверок §133.6 пройдено`);
process.exit(bad === 0 ? 0 : 1);
