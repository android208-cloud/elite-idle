/**
 * Экран подбора груза из обломков (§73).
 *
 * Проверяется то, что видит игрок: после победы появляется список
 * контейнеров, каждый можно взять отдельно, весь список тоже, а
 * ненужное можно выбросить из трюма, чтобы освободить место.
 *
 * Подбор запускается не боем (в jsdom драться долго и хрупко), а
 * подкладыванием состояния в beforeParse — тем же способом, что в
 * verify-encounter-turn. Каждая JSDOM получает СВОЁ хранилище, поэтому
 * сохранять надо ДО старта скриптов.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

function boot(save) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://elite.test/',
    virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
        arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
        measureText: (t) => ({ width: String(t).length * 6 }),
        set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
      });
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      w.cancelAnimationFrame = clearTimeout;
      if (save) w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(save));
    },
  });
  return dom.window;
}

/* Собираем сохранение с готовыми обломками: 3 контейнера, трюм пуст. */
const canisters = [
  { commodity: 0, amount: 1 },
  { commodity: 5, amount: 1 },
  { commodity: 6, amount: 1 },
];
const baseState = {
  version: 2, galaxy: 1, system: 7, cash: 1000, fuel: 70, holdSpace: 20,
  cargo: Array.from({ length: 17 }, () => 0),
  market: Array.from({ length: 17 }, () => ({ price: 100, quantity: 5 })),
  rng: 12345, flight: null,
  ship: { laser: 'pulse', missiles: 3, ecm: false, energyBomb: false, escapePod: false,
          energyUnit: false, fuelScoops: true, dockingComputer: false, galacticHyperdrive: false, cargoBayExtended: false },
  kills: 10, legal: 0, encounter: null, combat: null,
  salvage: { canisters, taken: 0, left: 0, pausedAt: 0, pausedMs: 0, enemyName: 'Krait' },
  stats: { kills: 10, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
  cargoBasis: Array.from({ length: 17 }, () => 0),
};
const save = { state: JSON.stringify(baseState), log: [], settings: { autoScoop: false } };

const w = boot(save);
await new Promise((r) => setTimeout(r, 900));

const doc = w.document;
const title = () => doc.getElementById('title').textContent;
const text = () => doc.getElementById('content').textContent;
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const byAction = (a, i) => [...doc.querySelectorAll(`[data-action="${a}"]`)].find((e) => i === undefined || e.dataset.i === String(i));

check('экран обломков открылся сам', title() === 'Обломки', `заголовок: ${title()}`);
check('в заголовке назван уничтоженный корабль', text().includes('Krait'));
check('видны все три контейнера', doc.querySelectorAll('[data-action="salvage-take"]').length === 3);
check('видно, что свободно в трюме', /Свободно в трюме: 20 т/.test(text()));
check('есть кнопка «Взять всё»', !!byAction('salvage-all'));
check('есть кнопка «Оставить»', !!byAction('salvage-close'));

// 1. Взятие одного контейнера
click(byAction('salvage-take', 0));
await new Promise((r) => setTimeout(r, 250));
check('после взятия осталось два контейнера', doc.querySelectorAll('[data-action="salvage-take"]').length === 2);
check('товар появился в трюме', /Еда: 1 т/.test(text()));
check('свободное место уменьшилось', /Свободно в трюме: 19 т/.test(text()));

// 2. Выброс груза во время подбора
const jet = byAction('jettison', 0);
check('в трюме есть кнопка выброса', !!jet);
click(jet);
await new Promise((r) => setTimeout(r, 250));
check('после выброса место вернулось', /Свободно в трюме: 20 т/.test(text()));
check('выброшенный товар ушёл из трюма', !/Еда: 1 т/.test(text()));

// 3. Навигация заблокирована: подбор нельзя «пропустить», уехав на вкладку
const navBefore = title();
const shipTab = [...doc.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'market');
click(shipTab);
await new Promise((r) => setTimeout(r, 200));
check('уйти на другую вкладку во время подбора нельзя', title() === navBefore, `заголовок: ${title()}`);

// 4. Взять всё
click(byAction('salvage-all'));
await new Promise((r) => setTimeout(r, 300));
check('после «взять всё» подбор закрылся', title() !== 'Обломки', `заголовок: ${title()}`);
check('оба оставшихся товара в трюме', /Предметы роскоши: 1 т/.test(text()) && /Наркотики: 1 т/.test(text()));

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
w.close();
process.exit(bad ? 1 : 0);
