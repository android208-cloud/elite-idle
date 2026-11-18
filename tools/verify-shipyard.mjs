/**
 * §102.4: верфь.
 *
 * Правила Elite-A (`n_buyship`):
 *   - продаются первые `15 - 2 * экономика` моделей из таблицы цен;
 *   - старый корабль идёт в зачёт по полной цене, платится разница;
 *   - новый корабль приходит голым.
 *
 * Отступления (проверяются здесь же): ГГД остаётся, правовой статус не
 * сбрасывается, груз сохраняется, а если не влезает — покупка отклоняется.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

/** ONRIRA (индекс 23) — богатая промышленная, экономика 0. */
const RICH = 23;
/** LAVE (индекс 7) — экономика 5, на верфи только Adder. */
const LAVE = 7;

function save({ system = RICH, cash = 400000, cargo = null, ship = {}, holdSpace = 8, app = null } = {}) {
  const state = {
    version: 3, galaxy: 1, system, cash, fuel: 60, holdSpace,
    cargo: cargo ?? Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'adder', laser: 'pulse', missiles: 1, ecm: true, energyBomb: true,
      energyUnit: false, fuelScoops: true, dockingComputer: false,
      galacticHyperdrive: true, cargoBayExtended: false, ...ship,
    },
    kills: 5, legal: 25, encounter: null, combat: null, salvage: null,
    stats: { kills: 5, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  const log = app ? [{ at: Date.now(), text: app }] : [];
  return { state: JSON.stringify(state), log, settings: {} };
}

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

const tabBtn = (w, id) => [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === id);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const content = (w) => w.document.getElementById('content').textContent.replace(/\s+/g, ' ');
const saved = (w) => JSON.parse(JSON.parse(w.localStorage.getItem('elite-idle-save-v1')).state);

async function hangar(opts) {
  const w = boot(save(opts));
  await new Promise((r) => setTimeout(r, 900));
  click(w, tabBtn(w, 'hangar'));
  await new Promise((r) => setTimeout(r, 250));
  return w;
}

/* ---------- Витрина ---------- */
{
  const w = await hangar();
  const text = content(w);
  check('верфь есть в ангаре', /Верфь/.test(text));
  check('зачёт вашего корабля назван', /Зачёт вашего Adder — 1000\.0 CR/.test(text));
  check('богатая система: все шесть моделей',
    ['Cobra Mk III', 'Fer-de-Lance', 'Python', 'Asp Mk II', 'Anaconda'].every((n) => text.includes(n)));
  check('цена Питона — 24 581 CR', /24581\.0 CR/.test(text), text.match(/Цена \d+\.\d CR/g)?.slice(0, 6).join(', ') ?? '');
  check('платится разница, а не вся цена', /Доплатить 23581\.0 CR/.test(text));
  check('ваш корабль помечен', /ваш корабль/.test(text));
  w.close();
}

/* ---------- Бедная система ---------- */
{
  const w = await hangar({ system: LAVE });
  const text = content(w);
  check('экономика 5: на верфи только Adder', !/Python/.test(text) && !/Cobra Mk III/.test(text));
  /*
   * §102.5: правило доступности НЕ объясняется. Пользователь: «должна
   * остаться интрига и тайна». Проверяем, что подсказка не вернулась.
   */
  check('правило доступности не разжёвано', !/продаётся \d+ из \d+ моделей/.test(text), text.slice(0, 0));
  check('и «богатой промышленной системы» в подписи нет', !/Богатая промышленная система —/.test(text));
  check('но зачёт и разница объяснены', /Зачёт вашего Adder/.test(text));
  w.close();
}

/* ---------- Покупка: один клик спрашивает, второй покупает ---------- */
{
  const w = await hangar({ cash: 400000 });
  const pythonBtn = [...w.document.querySelectorAll('[data-action="ship-buy"]')].find((b) => b.dataset.id === 'python');
  check('кнопка Питона активна', pythonBtn && !pythonBtn.disabled);
  click(w, pythonBtn);
  await new Promise((r) => setTimeout(r, 250));
  check('первый клик НЕ покупает — только спрашивает', saved(w).ship.model === 'adder');
  const text = content(w);
  check('в подтверждении сказано, что оборудование слетит', /Оборудование и ракеты слетят/.test(text));
  check('и что груз останется', /останется/.test(text));
  check('и сколько денег останется', /Денег останется/.test(text), text.match(/Денег останется [\d.]+ CR/)?.[0] ?? 'нет');

  const confirm = w.document.querySelector('[data-action="ship-confirm"]');
  check('есть кнопка подтверждения', !!confirm);
  click(w, confirm);
  await new Promise((r) => setTimeout(r, 300));

  const st = saved(w);
  check('корабль сменился на Питон', st.ship.model === 'python');
  check('деньги списались ровно на разницу', st.cash === 400000 + 10000 - 245810, `стало ${st.cash}`);
  check('оборудование слетело', st.ship.ecm === false && st.ship.energyBomb === false && st.ship.fuelScoops === false);
  check('лазера и ракет нет', st.ship.laser === 'none' && st.ship.missiles === 0);
  check('галактический двигатель остался', st.ship.galacticHyperdrive === true);
  check('правовой статус НЕ сброшен', st.legal === 25, `статус ${st.legal}`);
  check('трюм стал 106 т', st.holdSpace === 106);
  // Журнал на вкладке «Журнал», а не в ангаре — читаем из сохранения.
  const logText = JSON.parse(w.localStorage.getItem('elite-idle-save-v1')).log
    .map((e) => e.text).join(' | ');
  check('журнал записал покупку', /Куплен Python вместо Adder/.test(logText), logText.slice(-60));
  check('в шапке корабля теперь Питон', /Python/.test(content(w)));
  w.close();
}

/* ---------- Отмена ---------- */
{
  const w = await hangar({ cash: 400000 });
  click(w, [...w.document.querySelectorAll('[data-action="ship-buy"]')].find((b) => b.dataset.id === 'python'));
  await new Promise((r) => setTimeout(r, 200));
  click(w, w.document.querySelector('[data-action="ship-cancel"]'));
  await new Promise((r) => setTimeout(r, 200));
  check('отмена возвращает витрину', !w.document.querySelector('[data-action="ship-confirm"]'));
  check('корабль не изменился', saved(w).ship.model === 'adder');
  w.close();
}

/* ---------- Груз не влезает ---------- */
{
  // 10 т груза в Аддере нельзя, но фикстура может: 8 т влезают в 8, в Асп (6 т) — нет.
  const w = await hangar({ holdSpace: 0, cargo: [8, ...Array(16).fill(0)] });
  const text = content(w);
  check('груз 8 т не влезает в Асп (6 т)', /груз 8 т не влезет в 6 т/.test(text));
  const aspBtn = [...w.document.querySelectorAll('[data-action="ship-buy"]')].find((b) => b.dataset.id === 'asp');
  check('кнопки покупки Аспа нет', !aspBtn);
  check('а в Питон (106 т) — есть', !!text.match(/Python/) && !/груз 8 т не влезет в 106 т/.test(text));
  w.close();
}

/* ---------- §106: в ангаре модель СВОЕГО корабля ---------- */
{
  const w = await hangar({ ship: { model: 'python' } });
  const canvas = w.document.getElementById('ship-model');
  check('ангар рисует модель своего корабля, а не Кобру',
    canvas?.dataset.ship === 'python', canvas?.dataset.ship ?? 'нет канваса');
  check('и подпись называет тот же корабль', /Python · ваш корабль в ангаре/.test(content(w)));
  w.close();
}
{
  const w = await hangar({ ship: { model: 'anaconda' } });
  const canvas = w.document.getElementById('ship-model');
  check('после смены корабля модель меняется', canvas?.dataset.ship === 'anaconda', canvas?.dataset.ship ?? '');
  w.close();
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
