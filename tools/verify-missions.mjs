/**
 * §133.2: КОНТРАКТЫ — проверка через настоящее приложение.
 *
 * Доска появится на экране отдельным шагом (§133.3), но сроки живут в
 * `advance` уже сейчас — значит, их можно проверить через собранный файл:
 *   - просроченный контракт снимается при загрузке и первом тике, штраф
 *     списан, репутация упала, в журнале строка про срок;
 *   - штраф не уводит деньги в минус;
 *   - контракт со сроком впереди не трогается;
 *   - сейв версии 4 (без полей контрактов) открывается, а не отказывает.
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
const REORTE = 39;
const HOUR = 3_600_000;

/** Сохранение ровно того вида, какой пишет игра. */
function save({ cash = 200000, missions = null, rep = 0, version = 5, holdSpace = 8 } = {}) {
  const state = {
    version, galaxy: 1, system: LAVE, cash, fuel: 60, holdSpace,
    cargo: Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'adder', laser: 'pulse', missiles: 1, ecm: true, energyBomb: true,
      energyUnit: false, fuelScoops: true, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false,
    },
    kills: 0, legal: 0, encounter: null, combat: null, salvage: null,
    pilots: [], nextPilotId: 1,
    stats: { kills: 0, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, pilotIncome: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0, stations: [],
    missionRep: rep,
  };
  if (missions) {
    state.missions = missions;
    state.missionOffers = [];
    state.nextMissionId = 9;
  }
  return { state: JSON.stringify(state), log: [], settings: { speed: 1 } };
}

const mission = (deadline, tons = 0) => ({
  id: 1, kind: tons > 0 ? 'passenger' : 'courier', from: LAVE, to: REORTE,
  tons, hours: 3, deadline, reward: 5000, penalty: 1000, secret: false,
});

function boot(saved) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/',
    virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
        arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
        measureText: (t) => ({ width: String(t).length * 6 }),
        set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
      });
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      w.cancelAnimationFrame = clearTimeout;
      w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(saved));
    },
  });
  return dom.window;
}

const savedState = (w) => JSON.parse(JSON.parse(w.localStorage.getItem('elite-idle-save-v1')).state);
const log = (w) => JSON.parse(w.localStorage.getItem('elite-idle-save-v1')).log ?? [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Просроченный контракт ---------- */
{
  const w = boot(save({ missions: [mission(Date.now() - 60_000)] }));
  await wait(1200);
  const text = log(w).map((e) => (typeof e === 'string' ? e : e.text)).join(' | ');
  check('просроченный контракт упомянут в журнале', /срок вышел/i.test(text), text.slice(-120));
  const st = savedState(w);
  check('штраф списан', st.cash === 199000, String(st.cash));
  check('контракт снят', (st.missions ?? []).length === 0);
  check('репутация упала на 2', st.missionRep === -2, String(st.missionRep));
  w.close();
}

/* ---------- Штраф не уводит в минус ---------- */
{
  const w = boot(save({ cash: 500, missions: [mission(Date.now() - 60_000)] }));
  await wait(1200);
  const st = savedState(w);
  check('деньги не ушли в минус', st.cash === 0, String(st.cash));
  w.close();
}

/* ---------- Срок впереди: ничего не происходит ---------- */
{
  const w = boot(save({ missions: [mission(Date.now() + 10 * HOUR)] }));
  await wait(1200);
  const st = savedState(w);
  check('действующий контракт на месте', (st.missions ?? []).length === 1);
  check('деньги не тронуты', st.cash === 200000, String(st.cash));
  check('репутация не изменилась', (st.missionRep ?? 0) === 0);
  w.close();
}

/* ---------- Трюм под контракт остаётся занятым ---------- */
{
  // Аддер: 8 тонн. Пассажир на 3 тонны — свободно 5, и это должно пережить сейв.
  const w = boot(save({ holdSpace: 5, missions: [mission(Date.now() + 10 * HOUR, 3)] }));
  await wait(1200);
  const st = savedState(w);
  check('место под контракт не «потекло»', st.holdSpace === 5, String(st.holdSpace));
  check('и сам контракт с тонной жив', (st.missions ?? [])[0]?.tons === 3);
  w.close();
}

/* ---------- Сейв версии 4 читается ---------- */
{
  const w = boot(save({ version: 4, missions: null }));
  await wait(1200);
  const title = w.document.getElementById('title')?.textContent ?? '';
  check('сейв без контрактов открывается', title.length > 0, title);
  const st = savedState(w);
  check('поля контрактов появились', Array.isArray(st.missions) && typeof st.missionRep === 'number',
    `missions=${st.missions?.length} rep=${st.missionRep}`);
  w.close();
}

console.log(`\n${ok}/${ok + bad} проверок §133.2 пройдено`);
process.exit(bad === 0 ? 0 : 1);
