/**
 * §105: ФЛОТ — шаг 1 (торговые пилоты).
 *
 * Договорённости, которые проверяются здесь:
 *   - до ранга «Опытный» карточки нет вовсе (недоступное скрыто, а не
 *     подписано «заблокировано»);
 *   - наём в два клика: первый спрашивает, второй покупает корабль и платит
 *     задаток 500 CR;
 *   - маршрут назначается из системы найма, в пределах бака корабля;
 *   - один маршрут — один пилот;
 *   - пилот летает сам: после загрузки сейва с прошедшим рейсом деньги
 *     приходят, и в журнале есть строка «Флот: N рейсов».
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
/** REORTE — ближайший выгодный сосед LAVE: 4.4 св. года, 185.6 CR за рейс. */
const REORTE = 39;

function save({ kills = 128, cash = 200000, pilots = [], nextPilotId = 1 } = {}) {
  const state = {
    version: 4, galaxy: 1, system: LAVE, cash, fuel: 60, holdSpace: 8,
    cargo: Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'adder', laser: 'pulse', missiles: 1, ecm: true, energyBomb: true,
      energyUnit: false, fuelScoops: true, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false,
    },
    kills, legal: 0, encounter: null, combat: null, salvage: null,
    pilots, nextPilotId,
    stats: { kills, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [], settings: {} };
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
const byAction = (w, a, extra = {}) => [...w.document.querySelectorAll(`[data-action="${a}"]`)]
  .find((b) => Object.entries(extra).every(([k, v]) => b.dataset[k] === String(v)));
const saved = (w) => JSON.parse(JSON.parse(w.localStorage.getItem('elite-idle-save-v1')).state);
const log = (w) => JSON.parse(w.localStorage.getItem('elite-idle-save-v1')).log ?? [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * §115: флот переехал с ангара на отдельный экран «Пилоты».
 *
 * Хелпер открывает и его: проверки про наём и маршруты работают с тем же
 * набором кнопок, что и раньше, — поменялось только место.
 */
async function hangar(opts) {
  const w = boot(save(opts));
  await wait(900);
  click(w, tabBtn(w, 'hangar'));
  await wait(300);
  const open = byAction(w, 'pilots-open');
  if (open) {
    click(w, open);
    await wait(300);
  }
  return w;
}

/* ---------- Ранг: до «Опытного» флота нет ---------- */
{
  const w = await hangar({ kills: 64 });
  const text = content(w);
  check('«Слабый»/«Средний» не видит пилотов', !/Нанять пилота/.test(text));
  check('и карточки «Пилоты» нет', !/Пилот летает маршрут сам/.test(text));
  w.close();
}

/* ---------- «Опытный»: карточка есть ---------- */
{
  const w = await hangar();
  const text = content(w);
  check('с 128 убийств карточка «Пилоты» появляется', /Пилот летает маршрут сам/.test(text));
  check('доля объяснена: три четверти вам', /три четверти выручки — вам/.test(text));
  check('задаток назван: 500 CR', /задаток 500\.0 CR/.test(text));
  check('правило «один маршрут — один пилот» сказано', /Один маршрут — один пилот/.test(text));
  w.close();
}

/* ---------- §115: сводка в ангаре и отдельный экран ---------- */
{
  const w = boot(save());
  await wait(900);
  click(w, tabBtn(w, 'hangar'));
  await wait(300);

  const hangarText = content(w);
  check('в ангаре карточка-сводка', /Пилоты/.test(hangarText) && /Все пилоты →/.test(hangarText));
  check('сводка говорит «никого»', /никого/.test(hangarText));
  check('кнопки найма в ангаре нет', byAction(w, 'pilot-hire-open') === undefined);

  click(w, byAction(w, 'pilots-open'));
  await wait(300);
  check('клик открывает экран «Пилоты»', w.document.getElementById('title').textContent === 'Пилоты');
  check('на экране есть наём', byAction(w, 'pilot-hire-open') !== undefined);
  check('и кнопка «Назад»', byAction(w, 'pilots-close') !== undefined);

  click(w, byAction(w, 'pilots-close'));
  await wait(300);
  const back = w.document.getElementById('title').textContent;
  check('«Назад» возвращает в ангар', back !== 'Пилоты' && byAction(w, 'pilots-open') !== undefined, back);

  // Уход на другую вкладку закрывает экран: он живёт только над ангаром.
  click(w, byAction(w, 'pilots-open'));
  await wait(300);
  click(w, tabBtn(w, 'map'));
  await wait(300);
  click(w, tabBtn(w, 'hangar'));
  await wait(300);
  check('вкладка закрывает экран пилотов', byAction(w, 'pilots-close') === undefined
    && /Все пилоты →/.test(content(w)));
  w.close();
}

/* ---------- Наём в два клика ---------- */
{
  const w = await hangar();
  click(w, byAction(w, 'pilot-hire-open'));
  await wait(200);
  const text = content(w);
  check('в бедной системе для пилота только Adder', /Adder/.test(text) && !/Python/.test(text));
  check('цена пилота = корабль + задаток', /1500\.0 CR всего/.test(text));

  const before = saved(w).cash;
  click(w, byAction(w, 'pilot-hire-pick', { id: 'adder' }));
  await wait(200);
  check('первый клик только спрашивает', /Подтвердить/.test(content(w)));
  check('и денег ещё не списал', saved(w).cash === before);

  click(w, byAction(w, 'pilot-hire-confirm', { id: 'adder' }));
  await wait(300);
  const s1 = saved(w);
  check('второй клик нанимает', s1.pilots.length === 1);
  check('списано ровно 1 500 CR', before - s1.cash === 15000, `${(before - s1.cash) / 10} CR`);
  check('пилот пришёл без маршрута', s1.pilots[0].route === null);
  check('и сказано, что маршрут не задан', /Маршрут не задан/.test(content(w)));
  check('сразу открыт список маршрутов', byAction(w, 'pilot-route-set') !== undefined);

  /* ---------- Маршрут ---------- */
  const opt = byAction(w, 'pilot-route-set', { to: REORTE });
  check('в списке есть LAVE → REORTE', opt !== undefined);
  click(w, opt);
  await wait(300);
  const s2 = saved(w);
  check('маршрут записан', JSON.stringify(s2.pilots[0].route) === JSON.stringify({ from: LAVE, to: REORTE }));
  const text2 = content(w);
  check('карточка показывает маршрут', /LAVE → REORTE/.test(text2), text2.match(/LAVE → REORTE[^·]*/)?.[0] ?? '');
  // §107: торговец запрещёнку не берёт, поэтому его рейс — только законный
  // груз: 51.2 CR выручки, 38.4 CR вам.
  // §115: у пилота теперь своя карточка, поэтому подписи стали заголовками
  // полей («Рейс», «Вам», «В час»), а не строчкой через точку.
  check('показана выручка рейса', /Рейс\s*51\.2 CR/.test(text2), text2.match(/Рейс\s*[\d.]+ CR/)?.[0] ?? '');
  check('и ваша доля', /Вам\s*38\.4 CR/.test(text2));
  check('и доход в час целыми кредитами', /В час\s*14 CR/.test(text2), text2.match(/В час\s*[\d.]+ CR/)?.[0] ?? '');
  check('и время до возвращения', /Вернётся через/.test(text2));
  w.close();
}

/* ---------- §107: роли ---------- */
{
  const w = await hangar({
    pilots: [{
      id: 1, name: 'Рэй Дорн', ship: 'adder', home: LAVE,
      route: null, nextRunAt: 0, role: 'trader', runs: 0, failures: 0,
    }],
    nextPilotId: 2,
  });
  click(w, byAction(w, 'pilot-route', { i: 1 }));
  await wait(250);
  const trader = content(w);
  check('роль видна до назначения', /Торговец/.test(trader) && /Пират/.test(trader) && /Контрабандист/.test(trader));
  check('торговцу показан риск пиратов', /пираты \d/.test(trader));

  click(w, byAction(w, 'pilot-role', { role: 'smuggler' }));
  await wait(250);
  const smuggler = content(w);
  check('контрабандисту — досмотр', /досмотр \d/.test(smuggler));
  check('и его рейс дороже торгового', /вам 139\.2 CR за рейс/.test(smuggler), smuggler.match(/вам [\d.]+ CR за рейс/)?.[0] ?? '');
  check('предупреждение про запрещёнку', /запрещёнку/.test(smuggler));

  click(w, byAction(w, 'pilot-role', { role: 'pirate' }));
  await wait(250);
  const pirate = content(w);
  check('пирату — перехват и трепку', /перехват [\d.]+%/.test(pirate) && /трепка/.test(pirate));
  check('и сказано про розыск', /\+2 к розыску/.test(pirate));
  check('пиратский рейс дороже всех', /вам 181\.4 CR за рейс/.test(pirate), pirate.match(/вам [\d.]+ CR за рейс/)?.[0] ?? '');

  click(w, byAction(w, 'pilot-route-set'));
  await wait(350);
  const s2 = saved(w);
  check('роль записана вместе с маршрутом', s2.pilots[0].role === 'pirate');
  check('в журнале сказано, что это пират', log(w).some((l) => /пират/.test(l.text)));
  w.close();
}

/* ---------- §108: полицейский ---------- */
{
  const w = await hangar({
    pilots: [{
      id: 1, name: 'Нина Ларк', ship: 'adder', home: LAVE,
      route: null, nextRunAt: 0, role: 'trader', runs: 0, failures: 0,
    }],
    nextPilotId: 2,
  });
  click(w, byAction(w, 'pilot-route', { i: 1 }));
  await wait(250);
  click(w, byAction(w, 'pilot-role', { role: 'police' }));
  await wait(250);
  const text = content(w);
  check('роль полицейского есть', /Полицейский/.test(text));
  check('показан риск гибели и трепки', /гибель \d+% · трепка 4%/.test(text), text.match(/гибель[^·]*·[^ ]*/)?.[0] ?? '');
  check('сказано про надзор и награды', /надзору/.test(text) && /награды/.test(text));
  check('своя система доступна для дежурства', byAction(w, 'pilot-route-set', { to: LAVE }) !== undefined);

  click(w, byAction(w, 'pilot-route-set', { to: LAVE }));
  await wait(350);
  const s2 = saved(w);
  check('полицейский встал в свою же систему',
    s2.pilots[0].role === 'police' && s2.pilots[0].route.from === LAVE && s2.pilots[0].route.to === LAVE,
    JSON.stringify(s2.pilots[0].route));
  check('в карточке это «патруль», а не LAVE → LAVE', /патруль LAVE/.test(content(w)));
  check('в журнале назван полицейским', log(w).some((l) => /полицейский/i.test(l.text)));
  w.close();
}

/* ---------- Один маршрут — один пилот ---------- */
{
  const w = await hangar({
    pilots: [{
      id: 1, name: 'Вэл Кроу', ship: 'adder', home: LAVE,
      route: { from: LAVE, to: REORTE }, nextRunAt: 0, role: 'trader', runs: 0, failures: 0,
    }],
    nextPilotId: 2,
  });
  click(w, byAction(w, 'pilot-hire-open'));
  await wait(200);
  click(w, byAction(w, 'pilot-hire-pick', { id: 'adder' }));
  await wait(200);
  click(w, byAction(w, 'pilot-hire-confirm', { id: 'adder' }));
  await wait(300);
  const text = content(w);
  check('второму пилоту занятый маршрут закрыт', /маршрут занят/.test(text));
  check('но свободные маршруты остались', byAction(w, 'pilot-route-set') !== undefined);
  w.close();
}

/* ---------- Пилот летает сам ---------- */
{
  const startedAt = Date.now();
  const w = await hangar({
    pilots: [{
      id: 1, name: 'Рэй Дорн', ship: 'adder', home: LAVE,
      route: { from: LAVE, to: REORTE },
      // Половина суток назад пилот получил маршрут: часть рейсов уже была.
      nextRunAt: startedAt - 12 * 3_600_000, role: 'trader', runs: 0, failures: 0,
    }],
    nextPilotId: 2,
  });
  const s = saved(w);
  check('рейсы начислились при загрузке', s.pilots[0].runs > 0, `${s.pilots[0].runs} рейсов`);
  check('деньги пришли', s.cash > 200000, `+${((s.cash - 200000) / 10).toFixed(1)} CR`);
  check('в журнале строка флота', log(w).some((l) => /^Флот: \d+ рейс/.test(l.text)));
  w.close();
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad > 0 ? 1 : 0);
