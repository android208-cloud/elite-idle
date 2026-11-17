/**
 * В полёте рынок и ангар недоступны; журнал сворачивается (§75).
 *
 * Проверяем то, что видит игрок: в полёте вкладки «Рынок» и «Ангар»
 * приглушены и не открываются, а на станции снова работают. Журнал
 * свёрнут по умолчанию, разворачивается и сворачивается обратно.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

/** Сохранение с полётом или на станции — по флагу. */
function save(inFlight) {
  const state = {
    version: 2, galaxy: 1, system: 7, cash: 5000, fuel: 60, holdSpace: 20,
    cargo: Array(17).fill(0), market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: { laser: 'pulse', missiles: 3, ecm: false, energyBomb: false, escapePod: false,
            energyUnit: false, fuelScoops: false, dockingComputer: false, galacticHyperdrive: false, cargoBayExtended: false },
    kills: 5, legal: 0, encounter: null, combat: null, salvage: null,
    stats: { kills: 5, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0),
  };
  if (inFlight) {
    const now = Date.now();
    state.flight = { from: 7, to: 12, departAt: now - 1000, arriveAt: now + 600000, dueAt: now - 1000,
                     remainingBaseMs: 600000, elapsedBaseMs: 0, pending: [], fuelUsed: 3 };
  }
  return { state: JSON.stringify(state), log: [{ at: Date.now(), text: 'Тестовая запись' }], settings: {} };
}

function boot(inFlight) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/', virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
        arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
        measureText: (t) => ({ width: String(t).length * 6 }),
        set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
      });
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      w.cancelAnimationFrame = clearTimeout;
      w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(save(inFlight)));
    },
  });
  return dom.window;
}

const tabBtn = (w, id) => [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === id);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const title = (w) => w.document.getElementById('title').textContent;

/* ---------- В полёте ---------- */
const wf = boot(true);
await new Promise((r) => setTimeout(r, 900));
check('в полёте рынок приглушён', tabBtn(wf, 'market').classList.contains('off'));
check('в полёте ангар приглушён', tabBtn(wf, 'hangar').classList.contains('off'));
check('в полёте кнопки рынка и ангара выключены',
  tabBtn(wf, 'market').disabled && tabBtn(wf, 'hangar').disabled);
// Опечатка в первой версии: проверял `.off` у РЫНКА, а он как раз должен
// быть приглушён — проверка противоречила сама себе. Смысл в том, что
// корабль, карта и журнал остаются рабочими.
check('корабль, карта и журнал в полёте доступны',
  !tabBtn(wf, 'ship').disabled && !tabBtn(wf, 'map').disabled && !tabBtn(wf, 'log').disabled &&
  !tabBtn(wf, 'ship').classList.contains('off') && !tabBtn(wf, 'map').classList.contains('off'));

click(wf, tabBtn(wf, 'market'));
await new Promise((r) => setTimeout(r, 200));
check('нажатие на рынок в полёте не открывает его', title(wf) === 'Корабль', `заголовок: ${title(wf)}`);

click(wf, tabBtn(wf, 'hangar'));
await new Promise((r) => setTimeout(r, 200));
check('нажатие на ангар в полёте не открывает его', title(wf) === 'Корабль', `заголовок: ${title(wf)}`);

/* ---------- На станции ---------- */
const wd = boot(false);
await new Promise((r) => setTimeout(r, 900));
check('на станции рынок доступен', !tabBtn(wd, 'market').disabled && !tabBtn(wd, 'market').classList.contains('off'));
check('на станции ангар доступен', !tabBtn(wd, 'hangar').disabled);
click(wd, tabBtn(wd, 'market'));
await new Promise((r) => setTimeout(r, 200));
check('на станции рынок открывается', title(wd) === 'Рынок', `заголовок: ${title(wd)}`);
click(wd, tabBtn(wd, 'hangar'));
await new Promise((r) => setTimeout(r, 200));
check('на станции ангар открывается', title(wd) === 'Ангар', `заголовок: ${title(wd)}`);

/* ---------- Журнал ---------- */
click(wd, tabBtn(wd, 'log'));
await new Promise((r) => setTimeout(r, 250));
const text = () => wd.document.getElementById('content').textContent;
const toggle = () => wd.document.querySelector('[data-action="log-toggle"]');
check('журнал свёрнут по умолчанию', !!toggle() && /Развернуть \(\d+\)/.test(toggle().textContent), toggle()?.textContent.trim());
check('в свёрнутом виде список не показан', !wd.document.querySelector('.log'));
check('свёрнутый журнал показывает последнюю запись', /Тестовая запись/.test(text()));

click(wd, toggle());
await new Promise((r) => setTimeout(r, 250));
check('журнал разворачивается', !!wd.document.querySelector('.log'));
check('в развёрнутом виде кнопка «Свернуть»', /Свернуть/.test(toggle()?.textContent ?? ''));
check('записи видны', /Тестовая запись/.test(wd.document.querySelector('.log').textContent));

click(wd, toggle());
await new Promise((r) => setTimeout(r, 250));
check('журнал сворачивается обратно', !wd.document.querySelector('.log'));

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
wf.close(); wd.close();
process.exit(bad ? 1 : 0);
