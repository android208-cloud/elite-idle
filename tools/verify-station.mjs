/**
 * §125: ЦЕНА СТАНЦИИ В КАРТОЧКЕ СИСТЕМЫ.
 *
 * Пользователь: «сколько может стоить классическая станция», затем
 * «добавим „0“ к цене, ведь это станция, а не корабль».
 *
 * Проверяется то, что видит игрок:
 *   1. стоя у причала, он видит цену станции;
 *   2. цена записана целыми кредитами с разрядами, без «.0»;
 *   3. у LAVE цена 477 400 CR (родная система, знакомое число);
 *   4. у другой станции цена другая — это не константа в вёрстке;
 *   5. цена не зависит от денег игрока.
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

function boot(save) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://arena.test/',
    /*
     * Сейв кладём ДО запуска скрипта: игра читает localStorage сразу при
     * загрузке. И это не голое состояние, а обёртка { state, log }, где
     * state — JSON-строка (так же, как в остальных verify-скриптах).
     */
    beforeParse(w) {
      w.localStorage.setItem(SAVE_KEY, JSON.stringify({ state: JSON.stringify(save), log: [] }));
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      w.cancelAnimationFrame = clearTimeout;
    },
  });
  return dom.window;
}

const state = (cash) => ({
  version: 4, galaxy: 1, system: LAVE, cash, fuel: 60, holdSpace: 12,
  cargo: Array(17).fill(0),
  market: Array(17).fill({ price: 100, quantity: 5 }),
  rng: 7, flight: null,
  ship: { model: 'cobra3', laser: 'pulse', missiles: 2, ecm: false, energyBomb: false, energyUnit: false, fuelScoops: false, dockingComputer: false, galacticHyperdrive: false, cargoBayExtended: false },
  kills: 0, legal: 0, encounter: null, combat: null, salvage: null,
  pilots: [], nextPilotId: 1,
  stats: { kills: 0, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, raided: 0 },
  cargoBasis: Array(17).fill(0), cargoOrigin: [],
  escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const content = (w) => w.document.getElementById('content')?.textContent ?? '';
const byAction = (w, a) => w.document.querySelector(`[data-action="${a}"]`);

/* ---------- 1. у причала ---------- */
{
  const w = boot(state(5000));
  await wait(900);
  const text = content(w);
  check('стоя у причала, видна цена станции', /Станция · цена /.test(text), text.slice(0, 160));
  check('у LAVE цена 477 400 CR', /Станция · цена 477 400 CR/.test(text));
  check('без «.0» у цены станции', !/Станция · цена [\d ]+\.\d/.test(text));
  check('без разрядов слипшихся', !/Станция · цена \d{5,}/.test(text));
  w.close();
}

/* ---------- 2. цена не зависит от кошелька ---------- */
{
  const poor = boot(state(0));
  await wait(900);
  const rich = boot(state(9_000_000));
  await wait(900);
  const price = (w) => (content(w).match(/Станция · цена [\d ]+ CR/) ?? [''])[0];
  check('цена не зависит от денег игрока', price(poor) === price(rich) && price(poor) !== '', price(poor));
  poor.close(); rich.close();
}

/* ---------- 3. другая станция — другая цена ---------- */
{
  const s = state(5000);
  s.system = 151; // CEESXE, самый крупный мир галактики
  const w = boot(s);
  await wait(900);
  const text = content(w);
  check('на CEESXE цена своя: 2 962 500 CR', /Станция · цена 2 962 500 CR/.test(text), text.slice(0, 160));
  check('CEESXE дороже LAVE', text.includes('2 962 500'));
  w.close();
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad === 0 ? 0 : 1);
