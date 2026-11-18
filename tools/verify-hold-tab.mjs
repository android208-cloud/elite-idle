/**
 * §98: «Трюм» в полёте — список товаров и сброс.
 *
 * Проверяем в собранной игре то, что видит игрок:
 *   - в полёте вкладка называется «Трюм» и открывается;
 *   - запрещённый товар помечен и объяснён (без слова «контрабанда»);
 *   - «Сбросить всё» очищает позицию и освобождает место;
 *   - сброс попадает в журнал — иначе игрок не поймёт, куда делся груз;
 *   - на станции та же вкладка снова «Рынок».
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const SLAVES = 3;

function save(inFlight) {
  const state = {
    version: 3, galaxy: 1, system: 7, cash: 5000, fuel: 60, holdSpace: 18,
    cargo: Array(17).fill(0).map((_, i) => (i === SLAVES ? 2 : 0)),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: { laser: 'pulse', missiles: 3, ecm: false, energyBomb: false,
            energyUnit: false, fuelScoops: false, dockingComputer: false, galacticHyperdrive: false, cargoBayExtended: false },
    kills: 5, legal: 0, encounter: null, combat: null, salvage: null,
    stats: { kills: 5, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0),
    cargoOrigin: [{ commodity: SLAVES, amount: 2, added: 2, byPath: { bought: 2, salvage: 0, drifting: 0 } }],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  if (inFlight) {
    const now = Date.now();
    state.flight = { from: 7, to: 12, departAt: now - 1000, arriveAt: now + 600000, dueAt: now - 1000,
                     remainingBaseMs: 600000, elapsedBaseMs: 0, encounters: 0, lastEncounterAt: now - 1000, fuelUsed: 3 };
  }
  return { state: JSON.stringify(state), log: [{ at: Date.now(), text: 'Тестовая запись' }], settings: {} };
}

function boot(inFlight) {
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
      w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(save(inFlight)));
    },
  });
  return dom.window;
}

const tabBtn = (w, id) => [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === id);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const content = (w) => w.document.getElementById('content').textContent;

const w = boot(true);
await new Promise((r) => setTimeout(r, 900));

check('вкладка в полёте называется «Трюм»', /Трюм/.test(tabBtn(w, 'market').textContent));
click(w, tabBtn(w, 'market'));
await new Promise((r) => setTimeout(r, 250));
check('экран открыт', w.document.getElementById('title').textContent === 'Трюм');

check('запрещённый товар назван', /Рабы/.test(content(w)), '');
// §98.1: показываем только то, что лежит в трюме.
const goodsRows = [...w.document.querySelectorAll('[data-action="dropAll"]')].length;
check('в списке только товары из трюма — одна строка', goodsRows === 1, `строк: ${goodsRows}`);
check('пустых позиций нет', !/Еда/.test(content(w)) && !/Текстиль/.test(content(w)));
check('слово «контрабанда» не используется', !/контрабанд/i.test(content(w)));
check('есть предупреждение о невозможности побега', /побег/i.test(content(w)));
check('есть кнопки сброса', !!w.document.querySelector('[data-action="dropAll"]'));

const before = w.document.getElementById('content').textContent.match(/Занято (\d+) из (\d+)/);
check('шапка трюма показывает загрузку', !!before, before?.[0] ?? '');

// Сброс одной единицы рабов
const dropOne = [...w.document.querySelectorAll('[data-action="drop1"]')].find((b) => b.dataset.i === String(SLAVES));
check('у запрещённого товара есть кнопка «Сбросить 1»', !!dropOne);
click(w, dropOne);
await new Promise((r) => setTimeout(r, 250));
check('после сброса одной единицы осталась одна', /В трюме: 1 т/.test(content(w)), '');
check('журнал записал сброс', /Выброшено в космос: Рабы/.test(content(w)));

// Сброс всего
const dropAll = [...w.document.querySelectorAll('[data-action="dropAll"]')].find((b) => b.dataset.i === String(SLAVES));
click(w, dropAll);
await new Promise((r) => setTimeout(r, 250));
// Товар называется и в журнале («Выброшено в космос: Рабы»), поэтому
// проверяем не текст, а строки списка: кнопок сброса быть не должно.
check('«Сбросить всё» убирает позицию из списка (§98.1)',
  w.document.querySelectorAll('[data-action="dropAll"]').length === 0);
check('пустой трюм говорит об этом прямо', /Трюм пуст/.test(content(w)));
check('место в трюме вернулось', /Свободно: 20 т/.test(content(w)), content(w).match(/Свободно: \d+ т/)?.[0] ?? '');
check('журнал отметил, что побег снова возможен', /побег от статуса снова возможен/i.test(content(w)));
check('предупреждения о грузе больше нет', !/В трюме запрещённый товар/.test(content(w)));

// На станции та же вкладка — рынок
const wd = boot(false);
await new Promise((r) => setTimeout(r, 900));
check('на станции вкладка снова «Рынок»', /Рынок/.test(tabBtn(wd, 'market').textContent));
click(wd, tabBtn(wd, 'market'));
await new Promise((r) => setTimeout(r, 250));
check('на станции открывается рынок', wd.document.getElementById('title').textContent === 'Рынок');
check('на станции сброса нет', !wd.document.querySelector('[data-action="dropAll"]'));

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
w.close(); wd.close();
process.exit(bad ? 1 : 0);
