/**
 * §132: РЕДАКТОР ИНТЕРФЕЙСА.
 *
 * Пользователь: «сделай редактор интерфейса для нашей игры, включается в режиме
 * разработчика, в шапке по центру появляется значок карандаша, по нажатию
 * переходит в режим редактирования. там, нажатием выбирается редактируемая
 * карточка, где можно изменить её высоту, цвет и радиус скругления. по нажатию
 * на строку текста в этой карточке можно менять сам текст, положение текста,
 * размер шрифта, цвет. по нажатию на кнопку можно задать её жёсткий размер и
 * редактировать текст внутри».
 *
 * Проверяется поведение, а не наличие правил:
 *   1. карандаш появляется только в режиме разработчика;
 *   2. по нажатию включается режим правки и виден сам экран (а не отладка);
 *   3. нажатие на карточку выбирает её и открывает высоту/радиус/фон;
 *   4. нажатие на строку текста — текст/шрифт/цвет/положение;
 *   5. нажатие на кнопку — размер и текст, и НЕ выполняет действие игры;
 *   6. правки применяются сразу, переживают перерисовку и ложатся в localStorage;
 *   7. «Готово» выключает режим, правки остаются.
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
const EDIT_KEY = 'elite-idle-ui-edits-v1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const byAction = (w, a, extra = {}) => [...w.document.querySelectorAll(`[data-action="${a}"]`)]
  .find((b) => Object.entries(extra).every(([k, v]) => b.dataset[k] === String(v)));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const type = (w, el, value) => { el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); };

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

const state = {
  version: 4, galaxy: 1, system: LAVE, cash: 200_000, fuel: 20, holdSpace: 8,
  cargo: Array(17).fill(0), market: Array(17).fill({ price: 100, quantity: 5 }),
  rng: 1, flight: null,
  ship: { model: 'adder', laser: 'pulse', missiles: 1, ecm: false, energyBomb: false, energyUnit: false, fuelScoops: false, dockingComputer: false, galacticHyperdrive: false, cargoBayExtended: false },
  kills: 128, legal: 0, encounter: null, combat: null, salvage: null,
  pilots: [], nextPilotId: 1, stations: [],
  stats: { kills: 128, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, raided: 0 },
  cargoBasis: Array(17).fill(0), cargoOrigin: [], escapeRoute: [], escapeStatus: -1,
  careerMs: 0, careerAt: 0,
};

const w = boot({ state: JSON.stringify(state), log: [] });
await wait(900);
const doc = w.document;
const pencil = doc.getElementById('dev-pencil');
const panel = () => doc.getElementById('ui-editor');

check('§132: карандаш есть в разметке', pencil !== null);
check('§132: без режима разработчика карандаша не видно', pencil.hidden === true);

// В режим разработчика — через настройки на вкладке «Журнал», как игрок.
click(w, byAction(w, 'tab', { tab: 'log' }));
await wait(200);
click(w, byAction(w, 'dev-open'));
await wait(300);

/*
 * §132.1: карандаш достаёт КНОПКА в отладке, а включает правку уже карандаш.
 * Два разных действия, и проверяются они порознь.
 */
const editorBtn = () => doc.querySelector('[data-action="dev-editor"]');
check('§132.1: в отладке есть кнопка «Редактор»', editorBtn() !== null);
check('§132.1: пока кнопку не нажали, карандаша нет', pencil.hidden === true);
click(w, editorBtn());
await wait(300);
check('§132.1: нажали «Редактор» — карандаш появился', pencil.hidden === false);
check('§132.1: и правка ещё не включена', !doc.body.classList.contains('ui-editing'));
click(w, editorBtn());
await wait(300);
check('§132.1: нажали ещё раз — карандаш убран', pencil.hidden === true);
click(w, editorBtn());
await wait(300);

/*
 * §132.2: карандаш в шапке на ВСЕХ экранах.
 *
 * Пользователь: «Карандаш должен быть в шапке на всех экранах». Проверяем и
 * вкладки, и выход из отладки.
 */
const tabsAll = ['hangar', 'market', 'ship', 'map', 'log'];
const visible = [];
for (const t of tabsAll) {
  click(w, byAction(w, 'tab', { tab: t }));
  await wait(150);
  visible.push(`${t}:${pencil.hidden ? 'нет' : 'есть'}`);
}
check('§132.2: карандаш виден на каждой вкладке',
  visible.every((v) => v.endsWith('есть')), visible.join(' '));
check('§132.2: и это не мешает правке — она осталась выключенной',
  !doc.body.classList.contains('ui-editing'));

// Ушли из отладки — карандаш всё равно на месте.
click(w, byAction(w, 'tab', { tab: 'log' }));
await wait(150);
click(w, byAction(w, 'dev-open'));
await wait(200);
click(w, byAction(w, 'dev-close'));
await wait(300);
check('§132.2: после выхода из отладки карандаш остаётся', pencil.hidden === false);

click(w, byAction(w, 'tab', { tab: 'hangar' }));
await wait(200);

click(w, pencil);
await wait(300);
check('§132: режим правки включён', doc.body.classList.contains('ui-editing'));
check('§132: карандаш нажат', pencil.getAttribute('aria-pressed') === 'true');
check('§132: вместо отладки показан сам экран',
  !/Карта и флот/.test(doc.getElementById('content').textContent ?? ''),
  (doc.getElementById('content').textContent ?? '').slice(0, 24));

// Вкладки в режиме правки работают: по экранам надо ходить.
click(w, byAction(w, 'tab', { tab: 'hangar' }));
await wait(300);
check('§132: вкладки в режиме правки переключаются', /Топливо/.test(doc.getElementById('content').textContent ?? ''));
// §132.1: вкладка не должна ни закрывать правку, ни прятать карандаш.
check('§132.1: переход по вкладкам не выключает правку',
  doc.body.classList.contains('ui-editing') && pencil.hidden === false,
  `${doc.body.classList.contains('ui-editing')} / ${pencil.hidden}`);
check('§132: элементы размечены', doc.querySelectorAll('#content [data-ui-key]').length > 5,
  String(doc.querySelectorAll('#content [data-ui-key]').length));

// 3. Карточка «Топливо»: высота, радиус, фон.
const fuelCard = doc.querySelector('.sticky-fuel > .card');
click(w, fuelCard);
await wait(100);
check('§132: карточка выбрана и панель открыта', panel() !== null && panel().hidden === false);
check('§132: у карточки есть высота, радиус и фон',
  !!panel().querySelector('[data-ui-prop="h"]') && !!panel().querySelector('[data-ui-prop="r"]') &&
  !!panel().querySelector('[data-ui-prop="bg"]'));

type(w, panel().querySelector('[data-ui-prop="r"][data-ui-kind="number"]'), '24');
check('§132: радиус применяется сразу', fuelCard.style.borderRadius === '24px', fuelCard.style.borderRadius);
type(w, panel().querySelector('[data-ui-prop="h"][data-ui-kind="number"]'), '300');
check('§132: высота применяется сразу', fuelCard.style.height === '300px', fuelCard.style.height);
type(w, panel().querySelector('[data-ui-prop="bg"][data-ui-kind="text-color"]'), '#204040');
check('§132: фон применяется сразу', fuelCard.style.background.includes('32, 64, 64') || fuelCard.style.background === '#204040',
  fuelCard.style.background);

// 4. Строка текста.
const sub = fuelCard.querySelector('.sub');
click(w, sub);
await wait(100);
check('§132: нажатие на строку открывает её правки',
  !!panel().querySelector('[data-ui-prop="text"]') && !!panel().querySelector('[data-ui-prop="fs"]') &&
  !!panel().querySelector('[data-ui-prop="color"]'));
type(w, panel().querySelector('[data-ui-prop="text"]'), 'Привет, капитан');
check('§132: текст меняется', sub.textContent === 'Привет, капитан', sub.textContent);
type(w, panel().querySelector('[data-ui-prop="fs"][data-ui-kind="number"]'), '18');
check('§132: размер шрифта меняется', sub.style.fontSize === '18px', sub.style.fontSize);
const center = [...panel().querySelectorAll('[data-ui-act="align"]')].find((b) => b.dataset.uiVal === 'center');
click(w, center);
check('§132: положение строки меняется', sub.style.textAlign === 'center', sub.style.textAlign);

// §132.1: сдвиг самой строки — вправо и вниз.
type(w, panel().querySelector('[data-ui-prop="dx"][data-ui-kind="number"]'), '12');
type(w, panel().querySelector('[data-ui-prop="dy"][data-ui-kind="number"]'), '-6');
check('§132.1: строка сдвигается со своего места',
  sub.style.transform === 'translate(12px, -6px)', sub.style.transform);

// 5. Кнопка: размер и текст, действие игры не выполняется.
const before = doc.getElementById('content').textContent;
const refuel = fuelCard.querySelector('[data-action="refuel"][data-n]');
click(w, refuel);
await wait(100);
check('§132: нажатие на кнопку её выбирает', /Кнопка/.test(panel().textContent ?? ''),
  (panel().textContent ?? '').split('\n')[0].slice(0, 30));
check('§132: и не выполняет покупку топлива', doc.getElementById('content').textContent === before);
check('§132: у кнопки есть ширина и высота',
  !!panel().querySelector('[data-ui-prop="w"]') && !!panel().querySelector('[data-ui-prop="h"]'));
type(w, panel().querySelector('[data-ui-prop="w"][data-ui-kind="number"]'), '180');
check('§132: ширина кнопки задаётся жёстко', refuel.style.width === '180px', refuel.style.width);
type(w, panel().querySelector('[data-ui-prop="text"]'), 'Заправить');
check('§132: текст кнопки меняется', refuel.textContent === 'Заправить', refuel.textContent);
type(w, panel().querySelector('[data-ui-prop="dx"][data-ui-kind="number"]'), '-20');
check('§132.1: кнопка сдвигается со своего места',
  /^translate\(-20px(,\s*0(px)?)?\)$/.test(refuel.style.transform), refuel.style.transform);

// 6. Переживает перерисовку и ложится в localStorage.
click(w, byAction(w, 'tab', { tab: 'market' }));
await wait(300);
click(w, byAction(w, 'tab', { tab: 'hangar' }));
await wait(300);
const card2 = doc.querySelector('.sticky-fuel > .card');
check('§132: правки пережили перерисовку', card2.style.borderRadius === '24px' && card2.style.height === '300px',
  `${card2.style.borderRadius} / ${card2.style.height}`);
const stored = JSON.parse(w.localStorage.getItem(EDIT_KEY) ?? '{}');
check('§132: правки лежат в localStorage под именем экрана',
  !!stored.hangar && Object.keys(stored.hangar).length >= 3, Object.keys(stored.hangar ?? {}).join(', '));
check('§132: у правок есть кнопка выгрузки', !!doc.querySelector('[data-ui-act="export"]'));

// 7. «Готово» выключает режим, правки остаются.
click(w, doc.querySelector('[data-ui-act="done"]'));
await wait(300);
check('§132: режим правки выключен', !doc.body.classList.contains('ui-editing'));
check('§132: после выхода правки на месте',
  doc.querySelector('.sticky-fuel > .card')?.style.borderRadius === '24px',
  doc.querySelector('.sticky-fuel > .card')?.style.borderRadius);
check('§132: панель спрятана', panel().hidden === true);

w.close();

/*
 * §132.1: ПОКА ОТКРЫТ РЕДАКТОР, ИНТЕРФЕЙС СТОИТ.
 *
 * Проверяем на идущем полёте: тик каждый раз пересчитывает обратный отсчёт, и
 * без паузы текст меняется каждую секунду. В правке он обязан замереть.
 */
const flying = {
  ...state,
  flight: {
    from: LAVE, to: LAVE + 1, departAt: Date.now() - 1000, arriveAt: Date.now() + 600_000,
    remainingBaseMs: 600_000, elapsedBaseMs: 0, dueAt: Date.now(), pending: [],
    fuelUsed: 10, encounters: 0, lastEncounterAt: 0,
  },
};
const w2 = boot({ state: JSON.stringify(flying), log: [] });
await wait(900);
const doc2 = w2.document;
const eta = () => doc2.getElementById('flight-eta')?.textContent ?? '';
const byAction2 = (a, extra = {}) => [...doc2.querySelectorAll(`[data-action="${a}"]`)]
  .find((b) => Object.entries(extra).every(([k, v]) => b.dataset[k] === String(v)));
const click2 = (el) => el.dispatchEvent(new w2.MouseEvent('click', { bubbles: true, cancelable: true }));

click2(byAction2('tab', { tab: 'ship' }));
await wait(300);
const eta1 = eta();
await wait(1300);
check('§132.1: без редактора отсчёт идёт', eta() !== eta1, `${eta1} → ${eta()}`);

click2(byAction2('tab', { tab: 'log' }));
await wait(200);
click2(byAction2('dev-open'));
await wait(300);
click2(doc2.querySelector('[data-action="dev-editor"]'));
await wait(300);
click2(doc2.getElementById('dev-pencil'));
await wait(300);
click2(byAction2('tab', { tab: 'ship' }));
await wait(300);
const etaPaused = eta();
await wait(1600);
check('§132.1: в редакторе отсчёт замер', eta() === etaPaused, `${etaPaused} → ${eta()}`);

click2(doc2.getElementById('dev-pencil'));
await wait(300);
// Выход из правки возвращает обычный экран: вкладки в правке уже закрыли отладку.
await wait(200);
const resumed = eta();
await wait(1300);
check('§132.1: после выхода отсчёт пошёл снова', resumed !== '' && eta() !== resumed, `${resumed} → ${eta()}`);
w2.close();

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad === 0 ? 0 : 1);
