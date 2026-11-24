/**
 * §133.6: «СВЕРХНОВАЯ» — ЭКРАН.
 *
 * Ядро проверяет `test/supernova.test.ts`. Здесь — то, что видит игрок:
 *
 *   - во время события на «Рынке» появляется карточка «Сверхновая» и одна
 *     кнопка — «Взять беженцев»;
 *   - торговать, заправляться и брать контракты на этой станции нельзя;
 *   - после нажатия трюм занят целиком, кнопка гаснет;
 *   - без события всё работает как обычно — карточки нет, кнопки живые.
 *
 * Событие кладём прямо в сейв: путь «прыжок → прибытие → старт» проверен в
 * ядре, а гонять в jsdom прыжки незачем.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const HOUR = 3_600_000;
const NOW = Date.now();

function boot({ supernova, system = 3, holdSpace = 16, cargo, flight = null }) {
  const state = {
    version: 6, galaxy: 2, system, cash: 200000, fuel: 60, holdSpace,
    cargo: cargo ?? Array(17).fill(0).map((_, i) => (i === 0 ? 4 : 0)),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight,
    ship: {
      model: 'cobra3', laser: 'pulse', missiles: 4, ecm: false, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: true, cargoBayExtended: false,
    },
    kills: 600, legal: 0, encounter: null, combat: null, salvage: null,
    pilots: [], nextPilotId: 1, stations: [],
    stats: { kills: 600, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, pilotIncome: 0, jumps: 40, dockings: 0, dockingFails: 0, raided: 0, patrols: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [], escapeRoute: [], escapeStatus: -1,
    careerMs: 0, careerAt: 0,
    missions: [], missionOffers: [], missionRep: 0, nextMissionId: 1, missionRng: 1,
    supernova, destroyedStations: [], supernovaEndedAt: 0,
  };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/',
    virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.localStorage.setItem('elite-idle-save-v1', JSON.stringify({ state: JSON.stringify(state), log: [] }));
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
  return dom;
}

const event = {
  galaxy: 2, system: 3, startedAt: NOW - 60000, at: NOW + 3 * HOUR,
  leakedTo: NOW - 60000, maydayAt: NOW + HOUR, maydays: 0, taken: 0, refugees: false, escaped: false,
};

/* ---------- Событие идёт ---------- */
const dom = boot({ supernova: event });
const w = dom.window;
const d = w.document;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const text = () => d.getElementById('content').textContent.replace(/\s+/g, ' ');
await wait(900);
// Игра открывается на «Корабле» — идём туда, где живёт событие.
click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'market'));
await wait(300);

check('палитра события включена (html.supernova)',
  d.documentElement.classList.contains('supernova'));
const band = d.getElementById('supernova-band');
check('в шапке полоса «СВЕРХНОВА»', !!band && band.hidden === false && /СВЕРХНОВА/.test(band.textContent ?? ''),
  band?.textContent?.replace(/\s+/g, ' ') ?? 'нет полосы');
check('и в ней обратный отсчёт', /до взрыва \d/.test(band?.textContent ?? ''));

check('на «Рынке» карточка «Беженцы»', /Беженцы/.test(text()), text().slice(0, 130));
check('и цена у неё 0.0 CR', /0\.0 CR/.test(text()));
check('сказано, сколько беженцев на станции', /В наличии: 200 т/.test(text()));
check('сказано, что можно уйти в другую галактику без награды',
  /уходите в другую галактику, но награды не будет/.test(text()));
check('бесплатного выхода больше нет', !/бесплатн/i.test(text()));
check('из товаров остались только те, что в трюме, и без покупки',
  d.querySelectorAll('#content [data-action="buy1"], #content [data-action="sell1"]').length === 0,
  `${d.querySelectorAll('#content [data-action="buy1"]').length} карточек с покупкой`);
check('у товара в трюме кнопка «Оставить всё»',
  /Оставить всё/.test(text()) && !!d.querySelector('[data-action="leave-all"]'));
check('есть кнопка «Макс.»', !!d.querySelector('[data-action="refugees"]'),
  d.querySelector('[data-action="refugees"]')?.textContent?.trim() ?? '');
check('«Купить станцию» неактивна', d.querySelector('[data-action="station-buy"]')?.disabled === true);
check('контракты на этой станции закрыты', d.querySelector('[data-action="contracts-open"]')?.disabled === true);

/* ---------- Корабль: патруль и пиратство закрыты ---------- */
click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'ship'));
await wait(250);
const patrolBtn = d.querySelector('[data-action="patrol"]');
check('кнопка патруля/пиратства выключена', patrolBtn?.disabled === true,
  patrolBtn?.textContent?.trim() ?? 'кнопки нет');
check('и сказано, почему', /патруль и пиратство недоступны/.test(text()));

/* ---------- Ангар: только корабль и топливо ---------- */
click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'hangar'));
await wait(300);
const hangar = text();
check('в ангаре осталась карточка «Топливо»', /Топливо/.test(hangar));
check('и модель корабля', !!d.querySelector('#ship-model') || /пристыкован/.test(hangar));
check('вместо кнопок — «Топлива на станции не осталось»',
  /Топлива на станции не осталось/.test(hangar));
check('кнопок заправки нет', d.querySelectorAll('#content [data-action="refuel"]').length === 0);
check('оборудования и верфи в ангаре нет',
  !/Оборудование/.test(hangar) && !/Верфь/.test(hangar));

/* ---------- Оставляем груз и берём всех ---------- */
click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'market'));
await wait(300);
click(d.querySelector('[data-action="leave-all"]'));
await wait(250);
check('после «Оставить всё» товара в трюме нет', !/Товары: 4/.test(text()) && !d.querySelector('[data-action="leave-all"]'));

click(d.querySelector('[data-action="refugees"]'));
await wait(250);
const after = text();
check('«Макс.» взял всех, кто влез', /На борту: 20 т/.test(after), after.match(/В наличии[^·]*·[^·]*/)?.[0] ?? '');
check('трюм занят целиком', /Трюм 0 из 20/.test(after), after.match(/Трюм[^·]*/)?.[0] ?? '');
check('кнопка «Макс.» погасла', d.querySelector('[data-action="refugees"]')?.disabled === true);

// Разворачиваем журнал и читаем его целиком.
click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'log'));
await wait(250);
const expand = d.querySelector('[data-action="log-toggle"]');
if (expand && /Развернуть/.test(expand.textContent)) { click(expand); await wait(200); }
const journal = d.getElementById('content')?.textContent ?? '';

check('журнал записал, что оставили груз', /Оставлено на станции/.test(journal));
check('и что забрали всех беженцев', /Беженцы на борту: 20 т — забрали всех/.test(journal));
check('и на рынке после посадки про галактику больше не пишут', !/уходите в другую галактику/.test(text()));
w.close();

/* ---------- Без события всё по-старому ---------- */
const plain = boot({ supernova: null });
const w2 = plain.window;
const d2 = w2.document;
await wait(900);
w2.document.querySelector('[data-action="tab"][data-tab="market"]')
  .dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
await wait(300);
const text2 = () => d2.getElementById('content').textContent.replace(/\s+/g, ' ');
check('без события карточки «Сверхновая» нет', !text2().includes('Сверхновая'));
check('и палитра обычная', !d2.documentElement.classList.contains('supernova'));
check('полоса события спрятана', d2.getElementById('supernova-band')?.hidden === true);
const buy2 = [...d2.querySelectorAll('#content [data-action="buy1"]')];
check('и торговля живая', buy2.length > 0 && buy2.some((b) => !b.disabled));
w2.close();

/* ---------- §133.17: беженцы на борту ---------- */
/*
 * Пользователь: «забрал беженцев, но в трюме они не отображаются. По прибытии
 * на другую станцию в рынке их нет, чтобы высадить».
 *
 * Сейв: событие уже пережито (escaped), люди на борту, корабль стоит на
 * станции в другой системе. Трюм занят под них.
 */
const escapedEvent = {
  galaxy: 2, system: 3, startedAt: NOW - 3 * HOUR, at: NOW - HOUR,
  leakedTo: NOW - 3 * HOUR, maydayAt: NOW, maydays: 2,
  taken: 20, refugees: true, escaped: true,
};
const aboard = boot({
  supernova: escapedEvent, system: 11, holdSpace: 0, cargo: Array(17).fill(0),
});
const wa = aboard.window;
const da = wa.document;
await wait(900);
da.querySelector('[data-action="tab"][data-tab="market"]')
  .dispatchEvent(new wa.MouseEvent('click', { bubbles: true }));
await wait(300);
const aboardText = () => da.getElementById('content').textContent.replace(/\s+/g, ' ');
check('беженцы видны на рынке', /Беженцы/.test(aboardText()), aboardText().match(/Беженцы[^А-Я]{0,60}/)?.[0]);
check('и в трюме посчитаны', /Беженцы: 20 т/.test(aboardText()));
const drop = da.querySelector('[data-action="deliver-refugees"]');
check('кнопка «Высадить» есть и живая', !!drop && drop.disabled === false);
drop?.dispatchEvent(new wa.MouseEvent('click', { bubbles: true }));
await wait(350);
check('после высадки карточки беженцев нет', !/Высадить/.test(aboardText()));
check('камни в трюме', /Драгоценные камни/.test(aboardText()), aboardText().match(/Драгоценные камни[^А-Я]{0,40}/)?.[0]);
check('и трюм свободен', /Свободно: 20 т/.test(aboardText()));
da.querySelector('[data-action="tab"][data-tab="log"]')
  .dispatchEvent(new wa.MouseEvent('click', { bubbles: true }));
await wait(250);
const expand2 = da.querySelector('[data-action="log-toggle"]');
if (expand2 && /Развернуть/.test(expand2.textContent)) { expand2.dispatchEvent(new wa.MouseEvent('click', { bubbles: true })); await wait(200); }
check('в журнале написано о высадке', /Беженцы высажены/.test(da.getElementById('content').textContent));
wa.close();

/* ---------- §133.17: на той же станции высадить некуда ---------- */
const same = boot({
  supernova: { ...escapedEvent, system: 3 }, system: 3, holdSpace: 0, cargo: Array(17).fill(0),
});
const ws = same.window, ds = ws.document;
await wait(900);
ds.querySelector('[data-action="tab"][data-tab="market"]')
  .dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
await wait(300);
const sameText = ds.getElementById('content').textContent.replace(/\s+/g, ' ');
check('на станции отправления кнопка погашена',
  !!ds.querySelector('[data-action="deliver-refugees"]')?.disabled);
check('и сказано, почему', /откуда вы ушли/.test(sameText));
ws.close();

/* ---------- §133.17: в полёте видно, но высадить нельзя ---------- */
const inFlight = boot({
  supernova: { ...escapedEvent },
  holdSpace: 0,
  cargo: Array(17).fill(0),
  flight: {
    from: 3, to: 11, departAt: NOW, dueAt: NOW, arriveAt: NOW + 5 * 60_000,
    fuelUsed: 20, remainingBaseMs: 5 * 60_000, elapsedBaseMs: 0,
    encounters: 0, lastEncounterAt: 0, patrol: false, patrolFuelUsed: 0,
  },
});
const wf = inFlight.window, df = wf.document;
await wait(900);
df.querySelector('[data-action="tab"][data-tab="market"]')
  .dispatchEvent(new wf.MouseEvent('click', { bubbles: true }));
await wait(300);
const flightText = df.getElementById('content').textContent.replace(/\s+/g, ' ');
check('в полёте экран называется «Трюм»', /Трюм/.test(flightText));
check('и беженцы в нём видны', /На борту: 20 т/.test(flightText));
const flightDrop = df.querySelector('[data-action="deliver-refugees"]');
check('но высадить в полёте нельзя', !flightDrop || flightDrop.disabled === true,
  flightDrop ? flightDrop.outerHTML.slice(0, 120) + ' | ' + flightText.slice(0, 120) : 'кнопки нет');
wf.close();

console.log(`\n${ok}/${ok + bad} проверок §133.6 пройдено`);
process.exit(bad === 0 ? 0 : 1);
