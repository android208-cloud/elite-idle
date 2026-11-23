/**
 * §133.3: ЭКРАН «КОНТРАКТЫ».
 *
 * Что проверяется в собранной игре:
 *   - вход — кнопка «Контракты» на карточке «Станция» экрана «Рынок», и она
 *     стоит справа, последней в строке заголовка;
 *   - экран отдельный: заголовок «Контракты», «Назад» возвращает на рынок;
 *   - репутация — справа в шапке этого экрана;
 *   - доска из трёх предложений, взятие уменьшает трюм и снимает предложение;
 *   - «Сдать» есть только в целевой системе, иначе сказано словами, где сдавать;
 *   - отказ бесплатен, но стоит репутации;
 *   - отказ в взятии объяснён числами: три в работе / нет места в трюме;
 *   - любая вкладка закрывает экран.
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

const offer = (id, to, tons = 0, kind = tons > 0 ? 'passenger' : 'courier') => ({
  id, kind, from: LAVE, to, tons, hours: 3, deadline: 0,
  reward: 6500, penalty: 1300, secret: false,
});

const active = (id, to, tons = 0, leftMs = 5 * HOUR) => ({
  ...offer(id, to, tons), deadline: Date.now() + leftMs,
});

function save({
  cash = 200000, holdSpace = 20, missions = [], offers = null,
  rep = 4, nextId = 50, level = null,
} = {}) {
  const state = {
    version: 5, galaxy: 1, system: LAVE, cash, fuel: 60, holdSpace,
    cargo: Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'cobra3', laser: 'pulse', missiles: 3, ecm: false, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false,
    },
    kills: 5, legal: 0, encounter: null, combat: null, salvage: null,
    pilots: [], nextPilotId: 1, stations: [],
    stats: { kills: 5, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, pilotIncome: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [], escapeRoute: [], escapeStatus: -1,
    careerMs: 0, careerAt: 0,
    missions, missionRep: rep, nextMissionId: nextId, missionRng: 7,
    missionOffers: offers ?? [offer(1, REORTE), offer(2, 12, 2), offer(3, 55)],
  };
  if (level) state.flight = level;
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tabBtn = (w, id) => [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === id);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const text = (w) => w.document.getElementById('content').textContent.replace(/\s+/g, ' ');
const byAction = (w, a, extra = {}) => [...w.document.querySelectorAll(`[data-action="${a}"]`)]
  .find((b) => Object.entries(extra).every(([k, v]) => b.dataset[k] === String(v)));
const savedState = (w) => JSON.parse(JSON.parse(w.localStorage.getItem('elite-idle-save-v1')).state);
const log = (w) => (JSON.parse(w.localStorage.getItem('elite-idle-save-v1')).log ?? []).map((e) => e.text).join(' | ');

/** Открыть экран контрактов через настоящую кнопку на карточке станции. */
async function openContracts(opts) {
  const w = boot(save(opts));
  await wait(900);
  click(w, tabBtn(w, 'market'));
  await wait(300);
  const open = byAction(w, 'contracts-open');
  if (open) {
    click(w, open);
    await wait(300);
  }
  return w;
}

/* ---------- Вход с карточки станции ---------- */
{
  const w = boot(save());
  await wait(900);
  click(w, tabBtn(w, 'market'));
  await wait(300);

  const card = w.document.querySelector('#content .card');
  const open = byAction(w, 'contracts-open');
  check('на карточке станции есть «Контракты»', !!open, open?.textContent.trim() ?? 'нет кнопки');
  check('кнопка внутри карточки станции', !!open && card.contains(open));
  const row = open?.parentElement;
  check('кнопка стоит последней в строке — то есть справа',
    !!open && row?.classList.contains('row') && row.lastElementChild === open,
    row?.className ?? 'нет строки');
  check('слева от неё заголовок «Станция»', /Станция/.test(row?.firstElementChild?.textContent ?? ''));
  check('на рынке в шапке по-прежнему деньги', /CR$/.test(w.document.getElementById('top-info').textContent),
    w.document.getElementById('top-info').textContent);
  w.close();
}

/* ---------- Экран открывается и закрывается ---------- */
{
  const w = await openContracts();
  check('заголовок экрана — «Контракты»', w.document.getElementById('title').textContent === 'Контракты',
    w.document.getElementById('title').textContent);
  check('в шапке справа — репутация', w.document.getElementById('top-info').textContent === 'Репутация +4',
    w.document.getElementById('top-info').textContent);
  check('доска из трёх предложений', w.document.querySelectorAll('[data-action="mission-take"]').length === 3,
    String(w.document.querySelectorAll('[data-action="mission-take"]').length));
  check('три предложения названы словами', /Курьер/.test(text(w)) && /Пассажиры/.test(text(w)));

  click(w, byAction(w, 'contracts-close'));
  await wait(300);
  check('«Назад» возвращает на рынок', w.document.getElementById('title').textContent === 'Рынок',
    w.document.getElementById('title').textContent);
  check('и шапка снова показывает деньги', /CR$/.test(w.document.getElementById('top-info').textContent),
    w.document.getElementById('top-info').textContent);
  check('карточки станции снова видны', byAction(w, 'contracts-open') !== undefined);
  w.close();
}

/* ---------- Отрицательная репутация ---------- */
{
  const w = await openContracts({ rep: -3 });
  check('минус репутации подписан', w.document.getElementById('top-info').textContent === 'Репутация −3',
    w.document.getElementById('top-info').textContent);
  check('и объяснено, что она отнимает от оплаты', /отнимает 6 %/.test(text(w)), text(w).slice(0, 200));
  w.close();
}

/* ---------- Взятие контракта ---------- */
{
  const w = await openContracts();
  const take = byAction(w, 'mission-take', { id: 2 });
  check('пассажирский контракт можно взять при пустом трюме', take?.disabled === false);
  click(w, take);
  await wait(300);

  const st = savedState(w);
  check('контракт ушёл в работу', (st.missions ?? []).length === 1);
  check('трюм занят по-настоящему', st.holdSpace === 18, String(st.holdSpace));
  check('предложение снято с доски', (st.missionOffers ?? []).length === 2);
  check('журнал назвал контракт и срок', /Контракт взят: Пассажиры/.test(log(w)), log(w));
  check('на экране появилась карточка «В работе»', /В работе/.test(text(w)));
  // Возврат на рынок: кнопка на карточке станции должна показать, что в работе.
  click(w, byAction(w, 'contracts-close'));
  await wait(300);
  check('кнопка на станции считает взятые контракты', /Контракты \(1\) →/.test(text(w)),
    byAction(w, 'contracts-open')?.textContent.trim() ?? 'нет кнопки');
  w.close();
}

/* ---------- Сдать можно только в целевой системе ---------- */
{
  const w = await openContracts({ missions: [active(11, REORTE)], offers: [] });
  check('не в целевой — кнопки «Сдать» нет', byAction(w, 'mission-deliver') === undefined);
  check('и сказано, где сдавать', /Сдать можно в системе REORTE/.test(text(w)), text(w).slice(0, 240));
  check('отказ доступен', byAction(w, 'mission-abandon', { id: 11 }) !== undefined);
  w.close();
}

{
  const w = await openContracts({ missions: [active(11, LAVE)], offers: [] });
  const deliver = byAction(w, 'mission-deliver', { id: 11 });
  check('в целевой системе кнопка «Сдать» есть', !!deliver, deliver?.textContent ?? 'нет');
  check('и на ней награда', /650\.0 CR/.test(deliver?.textContent ?? ''), deliver?.textContent ?? '');
  click(w, deliver);
  await wait(300);
  const st = savedState(w);
  check('деньги пришли', st.cash === 200000 + 6500, String(st.cash));
  check('репутация выросла на 2', st.missionRep === 6, String(st.missionRep));
  check('контракт снят', (st.missions ?? []).length === 0);
  check('журнал записал сдачу', /Контракт сдан/.test(log(w)), log(w));
  w.close();
}

/* ---------- Отказ ---------- */
{
  const w = await openContracts({ missions: [active(11, REORTE, 2)], holdSpace: 18, offers: [] });
  click(w, byAction(w, 'mission-abandon', { id: 11 }));
  await wait(300);
  const st = savedState(w);
  check('отказ снимает контракт', (st.missions ?? []).length === 0);
  check('деньги не тронуты', st.cash === 200000, String(st.cash));
  check('репутация упала на 1', st.missionRep === 3, String(st.missionRep));
  check('трюм освобождён', st.holdSpace === 20, String(st.holdSpace));
  check('журнал объяснил цену отказа', /репутация −1/.test(log(w)), log(w));
  w.close();
}

/* ---------- Отказ в взятии объяснён ---------- */
{
  const three = [
    active(21, REORTE),
    active(22, 12),
    active(23, 55),
  ];
  const w = await openContracts({ missions: three, offers: [offer(1, REORTE)] });
  const take = byAction(w, 'mission-take', { id: 1 });
  check('при трёх в работе «Взять» выключена', take?.disabled === true);
  check('причина названа словами', /В работе уже 3 контракта/.test(text(w)), text(w).slice(0, 260));
  w.close();
}

{
  const w = await openContracts({ offers: [offer(1, REORTE, 5)], holdSpace: 2 });
  const take = byAction(w, 'mission-take', { id: 1 });
  check('без места в трюме «Взять» выключена', take?.disabled === true);
  check('причина с числами: нужно 5 т, свободно 2 т', /Нужно 5 т трюма, свободно 2 т/.test(text(w)),
    text(w).slice(0, 260));
  w.close();
}

/* ---------- Вкладка и полёт закрывают экран ---------- */
{
  const w = await openContracts();
  click(w, tabBtn(w, 'hangar'));
  await wait(300);
  click(w, tabBtn(w, 'market'));
  await wait(300);
  check('вкладка закрывает экран контрактов', byAction(w, 'contracts-close') === undefined
    && w.document.getElementById('title').textContent === 'Рынок');
  w.close();
}

{
  // В полёте вкладка «Рынок» — это «Трюм», и доски контрактов там быть не может.
  const now = Date.now();
  const flight = {
    from: LAVE, to: 12, departAt: now - 1000, arriveAt: now + 600000, dueAt: now - 1000,
    remainingBaseMs: 600000, elapsedBaseMs: 0, encounters: 0, lastEncounterAt: now - 1000, fuelUsed: 3,
  };
  const w = boot(save({ level: flight }));
  await wait(900);
  click(w, tabBtn(w, 'market'));
  await wait(300);
  check('в полёте кнопки контрактов нет', byAction(w, 'contracts-open') === undefined);
  check('в полёте вкладка — «Трюм»', w.document.getElementById('title').textContent === 'Трюм',
    w.document.getElementById('title').textContent);
  w.close();
}

console.log(`\n${ok}/${ok + bad} проверок §133.3 пройдено`);
process.exit(bad === 0 ? 0 : 1);
