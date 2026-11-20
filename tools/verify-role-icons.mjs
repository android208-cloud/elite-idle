/**
 * §130: ЗНАЧКИ РОЛЕЙ.
 *
 * Пользователь: «нарисуй векторные минималистичные значки для торговца
 * (знак доллара), пирата (череп), полиции (щит), охотника (пара скрещенных
 * мечей), контрабандист (придумай сам). Помести эти значки перед именами
 * пилотов и на главном экране в карточке встречи перед „в радиусе…“».
 *
 * Проверяется:
 *   1. значок стоит перед именем пилота и у каждой роли свой;
 *   2. в карточке встречи значок стоит перед словами «В радиусе»;
 *   3. охотник за головами — тоже со значком (скрещённые мечи);
 *   4. это вектор: <svg> внутри страницы, без картинок и эмодзи.
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
const content = (w) => w.document.getElementById('content');
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

const baseState = (extra = {}) => ({
  version: 4, galaxy: 1, system: LAVE, cash: 200_000, fuel: 60, holdSpace: 8,
  cargo: Array(17).fill(0), market: Array(17).fill({ price: 100, quantity: 5 }),
  rng: 1, flight: null,
  ship: { model: 'adder', laser: 'pulse', missiles: 1, ecm: true, energyBomb: true, energyUnit: false, fuelScoops: true, dockingComputer: false, galacticHyperdrive: false, cargoBayExtended: false },
  kills: 128, legal: 0, encounter: null, combat: null, salvage: null,
  pilots: [], nextPilotId: 1, stations: [],
  stats: { kills: 128, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, raided: 0 },
  cargoBasis: Array(17).fill(0), cargoOrigin: [], escapeRoute: [], escapeStatus: -1,
  careerMs: 0, careerAt: 0, ...extra,
});

const save = (state) => ({ state: JSON.stringify(state), log: [] });

/* ---------- 1. Пилоты: значок перед именем ---------- */
{
  const far = Date.now() + 1e9;
  const pilot = (id, name, role) => ({
    id, name, ship: 'adder', home: LAVE, route: { from: LAVE, to: 39 },
    nextRunAt: far, role, runs: 1, failures: 0, transfer: null,
  });
  const state = baseState({
    pilots: [pilot(1, 'Альфа', 'trader'), pilot(2, 'Бета', 'smuggler'), pilot(3, 'Гамма', 'pirate')],
    nextPilotId: 4,
  });
  const w = boot(save(state));
  await wait(900);
  click(w, byAction(w, 'tab', { tab: 'hangar' }));
  await wait(300);
  click(w, byAction(w, 'pilots-open'));
  await wait(300);

  const card = [...w.document.querySelectorAll('#content .card')]
    .find((c) => /Альфа/.test(c.textContent));
  const iconEl = card?.querySelector('.role-ico');
  check('§130: значок стоит в карточке пилота', iconEl !== undefined && iconEl !== null);
  check('§130: у торговца — знак доллара', iconEl?.dataset.role === 'trader');
  check('§130: значок это <svg>, а не картинка',
    iconEl?.querySelector('svg') !== null && card?.querySelector('img') === null);
  check('§130: значок идёт перед именем',
    card?.querySelector('h2')?.firstElementChild === iconEl,
    card?.querySelector('h2')?.innerHTML.slice(0, 60));

  const roles = [...w.document.querySelectorAll('#content .role-ico')].map((e) => e.dataset.role);
  check('§130: у контрабандиста своя маска', roles.includes('smuggler'), roles.join(' · '));
  check('§130: у пирата череп', roles.includes('pirate'), roles.join(' · '));
  w.close();
}

/* ---------- 2. Встреча: значок перед «В радиусе» ---------- */
{
  const now = Date.now();
  // Карточка встречи живёт в полёте: без перелёта её просто нет.
  const encounter = (role, enemyId, outcome = 'leave') => baseState({
    flight: {
      from: LAVE, to: (LAVE + 1) % 256, departAt: now, arriveAt: now + 9e9,
      remainingBaseMs: 9e9, elapsedBaseMs: 0, dueAt: now, pending: [],
      fuelUsed: 10, encounters: 0, lastEncounterAt: 0,
    },
    encounter: { role, enemyId, detectedAt: now, resolveAt: now + 9e9, outcome },
  });

  const pirate = boot(save(encounter('pirate', 'cobra3', 'attack')));
  await wait(900);
  const pirateIcon = content(pirate).querySelector('.role-ico');
  check('§130: на главном экране значок встречи есть', pirateIcon !== null);
  check('§130: у пирата он же — череп', pirateIcon?.dataset.role === 'pirate');
  check('§130: значок стоит перед «В радиусе»',
    pirateIcon?.nextSibling?.textContent?.startsWith('В радиусе') === true,
    pirateIcon?.nextSibling?.textContent?.slice(0, 30));
  pirate.close();

  const hunter = boot(save(encounter('hunter', 'ferdelance')));
  await wait(900);
  check('§130: у охотника за головами — скрещённые мечи',
    content(hunter).querySelector('.role-ico')?.dataset.role === 'hunter');
  hunter.close();

  const police = boot(save(encounter('police', 'viper')));
  await wait(900);
  check('§130: у полиции — щит',
    content(police).querySelector('.role-ico')?.dataset.role === 'police');
  police.close();

  const trader = boot(save(encounter('trader', 'cobra3')));
  await wait(900);
  check('§130: у торговца — знак доллара',
    content(trader).querySelector('.role-ico')?.dataset.role === 'trader');
  trader.close();
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad === 0 ? 0 : 1);
