/**
 * §133.15: ФЛОТ В ДРУГОЙ ГАЛАКТИКЕ — ЧТО ВИДИТ ИГРОК.
 *
 * Пользователь, глядя на карту после прыжка: «остались старые маршруты
 * пилотов». И дальше: «пилоты, оставшиеся в старой галактике, не должны быть
 * видны в ангаре новой и кредиты от них не должны поступать (но должны
 * копиться и быть зачислены на счёт игрока по возвращении)».
 *
 * Проверяем экраны:
 *   - маршруты рисуются только в своей галактике, и легенда тоже;
 *   - карточек чужих пилотов нет ни в ангаре, ни на «Пилотах»;
 *   - вместо них одна строка: сколько их и сколько накоплено;
 *   - в своей галактике всё как раньше.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const NAME = 'ЗВЕЗДА ПЕТРОВ';

/** Пилот: маршрут LAVE(7) → REORTE(39), как в проверках флота. */
const pilot = (galaxy, pending) => ({
  id: 1, name: NAME, ship: 'adder', home: 7, route: { from: 7, to: 39 },
  nextRunAt: Date.now() + 3_600_000, role: 'trader', runs: 3, failures: 0,
  transfer: null, galaxy, pending,
});

function boot({ pilots }) {
  const state = {
    version: 6, galaxy: 2, system: 3, cash: 100000, fuel: 60, holdSpace: 16,
    cargo: Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'cobra3', laser: 'pulse', missiles: 4, ecm: false, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: true, cargoBayExtended: false,
    },
    kills: 600, legal: 0, encounter: null, combat: null, salvage: null,
    pilots, nextPilotId: 2, stations: [],
    stats: { kills: 600, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, pilotIncome: 0, jumps: 12, dockings: 0, dockingFails: 0, raided: 0, patrols: 0 },
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
const text = (dom) => dom.window.document.getElementById('content').textContent.replace(/\s+/g, ' ');

async function open(dom, tab) {
  await wait(900);
  const d = dom.window.document;
  d.querySelector(`[data-action="tab"][data-tab="${tab}"]`)
    ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await wait(250);
}

/* ---------- 1. Флот остался в галактике 1, игрок в галактике 2 ---------- */
const away = boot({ pilots: [pilot(1, 12345)] });
await open(away, 'map');
const mapText = text(away);
check('на карте новой галактики нет маршрутов пилотов', !/Маршруты пилотов/.test(mapText));
check('и нет чужой легенды про «без маршрута»', !/без маршрута/.test(mapText));

await open(away, 'hangar');
const hangarText = text(away);
check('в ангаре нет карточки чужого пилота', !hangarText.includes(NAME), hangarText.slice(0, 80));
check('вместо неё сказано, что флот в другой галактике',
  /Здесь пилотов нет: флот остался в другой галактике/.test(hangarText));
check('и сколько накоплено',
  /Галактика 1: пилотов 1, накоплено 1234\.5 CR/.test(hangarText),
  (hangarText.match(/Галактика 1:[^.]*/) ?? ['нет строки'])[0].slice(0, 80));
check('и что зачислим по возвращении', /зачислим по возвращении/.test(hangarText));

await open(away, 'hangar');
away.window.document.querySelector('[data-action="pilots-open"]')
  ?.dispatchEvent(new away.window.MouseEvent('click', { bubbles: true }));
await wait(250);
const pilotsText = text(away);
check('на экране «Пилоты» чужой пилот тоже не карточка', !pilotsText.includes(NAME));
check('но строка про его сбережения есть', /Галактика 1: пилотов 1/.test(pilotsText));

/* ---------- 2. Свой флот — как раньше ---------- */
const home = boot({ pilots: [pilot(2, 0)] });
await open(home, 'map');
check('в своей галактике маршруты на карте', /Маршруты пилотов/.test(text(home)));
await open(home, 'hangar');
const homeText = text(home);
check('и карточка пилота в ангаре на месте', /Пилотов 1/.test(homeText), homeText.match(/Пилотов \d+/)?.[0] ?? '');
check('без строки про чужую галактику', !/флот остался в другой галактике/.test(homeText));
check('и без «накоплено»', !/накоплено/.test(homeText));

console.log(`\n${bad === 0 ? '✅' : '❌'} ${ok}/${ok + bad} проверок §133.15 пройдено`);
process.exit(bad === 0 ? 0 : 1);
