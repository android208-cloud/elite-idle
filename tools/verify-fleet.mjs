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

function save({ kills = 128, cash = 200000, pilots = [], nextPilotId = 1, system = LAVE } = {}) {
  const state = {
    version: 4, galaxy: 1, system, cash, fuel: 60, holdSpace: 8,
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

/* ---------- §116: порядок по доходу ---------- */
{
  // Пилот без маршрута приносит ноль — в списке он должен оказаться последним,
  // даже если нанят первым.
  const far = Date.now() + 1e9;
  const idle = {
    id: 2, name: 'Бета', ship: 'adder', home: LAVE, route: null,
    nextRunAt: far, role: 'trader', runs: 0, failures: 0,
  };
  const worker = {
    id: 1, name: 'Альфа', ship: 'adder', home: LAVE, route: { from: LAVE, to: REORTE },
    nextRunAt: far, role: 'trader', runs: 0, failures: 0,
  };
  const w = boot(save({ pilots: [idle, worker], nextPilotId: 3 }));
  await wait(900);
  click(w, tabBtn(w, 'hangar'));
  await wait(300);
  click(w, byAction(w, 'pilots-open'));
  await wait(300);

  const names = [...w.document.querySelectorAll('#content h2')].map((h) => h.textContent);
  /*
   * §124: «Нанять пилота» теперь первая карточка экрана — иначе с ростом
   * флота она уезжала вниз на десяток экранов. Поэтому порядок проверяем
   * по списку БЕЗ неё.
   */
  check('§124: «Нанять пилота» — первой карточкой', names[0] === 'Нанять пилота', names.join(' · '));
  const pilots = names.filter((n) => n !== 'Нанять пилота');
  check('пилот с маршрутом — первым', pilots[0] === 'Альфа', pilots.join(' · '));
  check('пилот без маршрута — в конце', pilots[1] === 'Бета');
  check('в шапке сказано, в каком порядке', /Сверху — кто приносит больше в час/.test(content(w)));

  // Кнопка найма действительно выше первой карточки пилота в разметке.
  const hire = byAction(w, 'pilot-hire-open');
  const firstPilot = byAction(w, 'pilot-route');
  check('§124: кнопка найма выше списка пилотов',
    hire !== undefined && firstPilot !== undefined
      && (hire.compareDocumentPosition(firstPilot) & w.Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  w.close();
}

/* ---------- Наём в два клика ---------- */
{
  const w = await hangar();
  click(w, byAction(w, 'pilot-hire-open'));
  await wait(200);
  const text = content(w);
  check('в бедной системе для пилота только Adder', /Adder/.test(text) && !/Python/.test(text));
  check('цена пилота = корабль + задаток', /1500\.0 CR/.test(text));
  /*
   * §127: пользователь попросил вместо слова «всего» показать радиус
   * прыжка. Радиус — то, из-за чего выбор корабля вообще меняет маршрут:
   * Аддер уходит на 6.0 св. г., Питон на 8.0, Асп на 12.5.
   */
  check('§127: в карточке найма вместо «всего» радиус прыжка', /Радиус 6\.0 св\. г\./.test(text), text.match(/Радиус[^·]*/)?.[0] ?? '');
  check('§127: слова «всего» больше нет', !/всего/.test(text));

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
  // §121: досмотр поднимает ВАШ розыск, а не «чей-то» — это и была
  // причина двух «пиратств подряд».
  check('§121: и сказано, что досмотр поднимает ваш розыск',
    /при досмотре ваш розыск \+2/.test(smuggler), smuggler.match(/при досмотре[^·]*/)?.[0] ?? '');
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

  /*
   * §132.12: перед «занят» стоит значок того, кто занял линию.
   *
   * Пользователь: «Для пилота перед кнопками „лететь" и „занят" поставить
   * значки, кем занят маршрут».
   */
  const busyRow = [...w.document.querySelectorAll('[data-route-card] .good-row')]
    .find((r) => /маршрут занят/.test(r.textContent ?? ''));
  const guard = busyRow?.querySelector('.lane-guard');
  check('§132.12: у занятой линии есть значок', !!guard, guard?.textContent ?? '');
  check('§132.12: значок показывает роль занявшего',
    guard?.querySelector('[data-role="trader"]') !== undefined,
    [...(guard?.querySelectorAll('[data-role]') ?? [])].map((n) => n.dataset.role).join(','));
  check('§132.12: значок стоит ПЕРЕД пометкой «занят»',
    !!guard && !!(busyRow.querySelector('.lane-guard').compareDocumentPosition(
      [...busyRow.children].find((c) => /маршрут занят/.test(c.textContent ?? '')),
    ) & w.Node.DOCUMENT_POSITION_FOLLOWING));
  check('§132.12: в подсказке значка — роль и имя',
    /торговец/i.test(guard?.querySelector('[title]')?.getAttribute('title') ?? '') &&
      /Вэл Кроу/.test(guard?.querySelector('[title]')?.getAttribute('title') ?? ''),
    guard?.querySelector('[title]')?.getAttribute('title'));
  w.close();
}

/* ---------- §132.12: чужой пилот виден и там, где «Лететь» разрешено ---------- */
{
  const w = await hangar({
    pilots: [
      {
        id: 1, name: 'Вэл Кроу', ship: 'adder', home: LAVE,
        route: { from: LAVE, to: REORTE }, nextRunAt: 0, role: 'trader', runs: 0, failures: 0,
      },
      {
        id: 2, name: 'Мара Кейн', ship: 'adder', home: LAVE,
        route: null, nextRunAt: 0, role: 'police', runs: 0, failures: 0,
      },
    ],
    nextPilotId: 3,
  });
  click(w, byAction(w, 'pilot-route', { i: 2 }));
  await wait(300);
  const row = [...w.document.querySelectorAll('[data-route-card] .good-row')]
    .find((r) => /REORTE/.test(r.textContent ?? ''));
  check('§132.12: полицейскому линия торговца свободна', !!row && !!row.querySelector('[data-action="pilot-route-set"]'));
  check('§132.12: но занявший значком показан и здесь',
    row?.querySelector('.lane-guard [data-role="trader"]') !== undefined,
    row?.querySelector('.lane-guard')?.textContent ?? '');
  const freeRow = [...w.document.querySelectorAll('[data-route-card] .good-row')]
    .find((r) => !/REORTE/.test(r.textContent ?? ''));
  check('§132.12: на свободной линии значка нет', !freeRow || !freeRow.querySelector('.lane-guard'),
    (freeRow?.textContent ?? '').slice(0, 40));
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


/* ---------- §120: ранги пилота и встречи ---------- */
/*
 * Пользователь: «ранги пилота — такие же, как у нас», а встречи — «как если
 * бы мы сами летели по этому маршруту». В карточке должны быть видны обе
 * вещи: титул из общей таблицы, цена ступени и число встреч за рейс.
 */
{
  const w = await hangar({
    pilots: [{
      id: 1, name: 'Рэй Дорн', ship: 'adder', home: LAVE,
      route: { from: LAVE, to: REORTE },
      nextRunAt: Date.now() + 3_600_000, role: 'trader', runs: 0, failures: 0,
    }],
    nextPilotId: 2,
  });
  const text = content(w);
  check('§120: ранг пилота в карточке', /Ранг: Безобидный/.test(text), text.match(/Ранг: [^·]+/)?.[0] ?? '');
  check('§120: цена ступени объяснена', /\+0% дохода, −0% риска/.test(text));
  check('§120: до следующего ранга — один рейс', /до «Почти безобидный» 1 рейс/.test(text));
  check('§120: встречи за рейс посчитаны', /встреч за рейс 14/.test(text),
    text.match(/встреч за рейс \d+/)?.[0] ?? '');
  check('§120: новичок получает обычную долю', /Вам38\.4 CR/.test(text),
    text.match(/Вам[\d.]+ CR/)?.[0] ?? '');
  w.close();
}

{
  const w = await hangar({
    pilots: [{
      id: 1, name: 'Рэй Дорн', ship: 'adder', home: LAVE,
      route: { from: LAVE, to: REORTE },
      nextRunAt: Date.now() + 3_600_000, role: 'trader', runs: 128, failures: 0,
    }],
    nextPilotId: 2,
  });
  const text = content(w);
  check('§120: 128 рейсов — «ЭЛИТА»', /Ранг: ЭЛИТА/.test(text));
  check('§120: надбавка +32%', /\+32% дохода, −40% риска/.test(text));
  check('§120: доход вырос на треть', /Вам50\.7 CR/.test(text), text.match(/Вам[\d.]+ CR/)?.[0] ?? '');
  check('§120: дальше расти некуда', /предел/.test(text));
  w.close();
}

{
  // Тот же пират, но с рангом: перехват реже — 4.5% против 2.7%.
  const mkPirate = (runs) => ({
    pilots: [{
      id: 1, name: 'Рэй Дорн', ship: 'adder', home: LAVE,
      route: { from: LAVE, to: REORTE },
      nextRunAt: Date.now() + 3_600_000, role: 'pirate', runs, failures: 0,
    }],
    nextPilotId: 2,
  });
  const a = await hangar(mkPirate(0));
  check('§120: у новичка перехват 4.5%', /перехват 4\.5%/.test(content(a)));
  a.close();
  const b = await hangar(mkPirate(128));
  check('§120: у «ЭЛИТЫ» перехват 2.7%', /перехват 2\.7%/.test(content(b)));
  b.close();
}

/* ---------- §126: маршрут — тоже над списком ---------- */
{
  const far = Date.now() + 1e9;
  const flying = {
    id: 1, name: 'Альфа', ship: 'adder', home: LAVE, route: { from: LAVE, to: REORTE },
    nextRunAt: far, role: 'trader', runs: 0, failures: 0,
  };
  const idle = {
    id: 2, name: 'Бета', ship: 'adder', home: LAVE, route: null,
    nextRunAt: far, role: 'trader', runs: 0, failures: 0,
  };
  const w = await hangar({ pilots: [flying, idle], nextPilotId: 3 });

  check('§126: пока маршрут не открыт, панели нет', w.document.querySelector('[data-route-card]') === null);

  click(w, byAction(w, 'pilot-route', { i: 2 }));
  await wait(300);

  const panel = w.document.querySelector('[data-route-card]');
  check('§126: панель маршрута открылась', panel !== null);
  check('§126: панель подписана именем пилота', /Маршрут: Бета/.test(content(w)));
  check('§126: панель — отдельная карточка, а не внутри пилота',
    panel !== null && panel.parentElement === w.document.getElementById('content'));

  const firstPilot = byAction(w, 'pilot-route', { i: 1 });
  check('§126: панель выше первой карточки пилота',
    panel !== null && firstPilot !== undefined
      && (panel.compareDocumentPosition(firstPilot) & w.Node.DOCUMENT_POSITION_FOLLOWING) !== 0);

  const text = content(w);
  check('§126: блок найма по-прежнему выше маршрута',
    text.indexOf('Нанять пилота') >= 0 && text.indexOf('Нанять пилота') < text.indexOf('Маршрут: Бета'));

  // REORTE занят Альфой (§105: один маршрут — один пилот), поэтому берём
  // первую свободную строку панели и сверяем маршрут именно с ней.
  const free = byAction(w, 'pilot-route-set', { i: 2 });
  const freeTo = Number(free.dataset.to);
  click(w, free);
  await wait(300);
  const s = saved(w);
  check('§126: маршрут назначается прямо из верхней панели',
    s.pilots.find((x) => x.id === 2)?.route?.to === freeTo);

  // Назначение маршрута закрывает панель само — это подтверждение действия.
  check('§126: после назначения панель закрылась', w.document.querySelector('[data-route-card]') === null);

  // А кнопка «Свернуть» нужна для отказа: открыли и передумали.
  click(w, byAction(w, 'pilot-route', { i: 2 }));
  await wait(300);
  const close = byAction(w, 'pilot-route-close');
  check('§126: в панели есть «Свернуть»', close !== undefined);
  click(w, close);
  await wait(300);
  check('§126: «Свернуть» закрывает панель', w.document.querySelector('[data-route-card]') === null);
  w.close();
}

/* ---------- §128: пилот переезжает и меняет корабль ---------- */
{
  const far = Date.now() + 1e9;
  const pilot = {
    id: 1, name: 'Альфа', ship: 'adder', home: LAVE, route: { from: LAVE, to: REORTE },
    nextRunAt: far, role: 'trader', runs: 3, failures: 0, transfer: null,
  };
  const w = await hangar({ pilots: [pilot], nextPilotId: 2, cash: 500_000 });

  const moveBtn = byAction(w, 'pilot-move', { i: 1 });
  const routeBtn = byAction(w, 'pilot-route', { i: 1 });
  check('§128: «Сменить планету» есть в карточке пилота', moveBtn !== undefined);
  check('§128: она левее «Сменить маршрут»',
    moveBtn !== undefined && routeBtn !== undefined
      && (moveBtn.compareDocumentPosition(routeBtn) & w.Node.DOCUMENT_POSITION_FOLLOWING) !== 0);

  click(w, moveBtn);
  await wait(300);
  const panel = w.document.querySelector('[data-move-card]');
  check('§128: панель перелёта — отдельная карточка над списком',
    panel !== null && panel.parentElement === w.document.getElementById('content'));
  check('§128: панель подписана именем пилота', /Перелёт: Альфа/.test(content(w)));
  check('§128: видно топливо и время в пути', /топливо [\d.]+ CR · в пути/.test(content(w)));

  const dest = w.document.querySelector('[data-action="pilot-move-set"]');
  const to = Number(dest.dataset.to);
  const cashBefore = saved(w).cash;
  click(w, dest);
  await wait(400);
  const afterMove = saved(w);
  check('§128: пилот улетел на выбранную планету', afterMove.pilots[0].home === to);
  check('§128: прежний маршрут снят', afterMove.pilots[0].route === null);
  check('§128: топливо оплатил командир', cashBefore - afterMove.cash > 0, `${(cashBefore - afterMove.cash) / 10} CR`);
  check('§128: в карточке видно перелёт', /летит .* → .*прибудет через/.test(content(w)));
  w.close();
}

/* ---------- §128: смена корабля пилота ---------- */
{
  const RICH = 151; // CEESXE: экономика 0, на верфи весь список
  const pilot = {
    id: 1, name: 'Бета', ship: 'adder', home: RICH, route: null,
    nextRunAt: Date.now() + 1e9, role: 'trader', runs: 0, failures: 0, transfer: null,
  };
  const w = await hangar({ pilots: [pilot], nextPilotId: 2, cash: 500_000, system: RICH });

  click(w, byAction(w, 'pilot-refit', { i: 1 }));
  await wait(300);
  check('§128: панель корабля открылась', w.document.querySelector('[data-refit-card]') !== null);
  const cobra = byAction(w, 'pilot-refit-set', { i: 1, id: 'cobra3' });
  check('§128: на богатой верфи есть Cobra Mk III', cobra !== undefined);

  const before = saved(w).cash;
  click(w, cobra);
  await wait(400);
  const s = saved(w);
  check('§128: корабль пилота сменён', s.pilots[0].ship === 'cobra3');
  // Доплата — разница цен верфи: 9 258 − 1 000 = 8 258 CR.
  check('§128: старый корабль ушёл в зачёт', before - s.cash === 82_580, `${(before - s.cash) / 10} CR`);
  w.close();
}

/* ---------- §129: полицейский на линии торговца ---------- */
{
  const far = Date.now() + 1e9;
  const trader = {
    id: 1, name: 'Альфа', ship: 'adder', home: LAVE, route: { from: LAVE, to: REORTE },
    nextRunAt: far, role: 'trader', runs: 2, failures: 0, transfer: null,
  };
  const cop = {
    id: 2, name: 'Бета', ship: 'adder', home: LAVE, route: null,
    nextRunAt: far, role: 'trader', runs: 0, failures: 0, transfer: null,
  };
  const w = await hangar({ pilots: [trader, cop], nextPilotId: 3, cash: 500_000 });

  // Открываем маршруты второму пилоту и выбираем роль «Полицейский».
  click(w, byAction(w, 'pilot-route', { i: 2 }));
  await wait(300);
  const roleBtn = byAction(w, 'pilot-role', { role: 'police' });
  check('§129: роль «Полицейский» есть в панели', roleBtn !== undefined);
  click(w, roleBtn);
  await wait(300);

  const toTraderLane = byAction(w, 'pilot-route-set', { i: 2, to: REORTE });
  check('§129: линия торговца для полицейского открыта', toTraderLane !== undefined);
  check('§129: и не подписана «маршрут занят»', !/маршрут занят/.test(content(w)));

  click(w, toTraderLane);
  await wait(400);
  const s = saved(w);
  const placed = s.pilots.find((p) => p.id === 2);
  check('§129: полицейский встал на ту же линию', placed?.route?.to === REORTE && placed?.role === 'police');
  w.close();
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad > 0 ? 1 : 0);
