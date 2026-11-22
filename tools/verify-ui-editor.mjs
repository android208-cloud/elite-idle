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

function boot(save, edits = null) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://arena.test/',
    beforeParse(w) {
      w.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      if (edits) w.localStorage.setItem(EDIT_KEY, edits);
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
 * §132.3: НЕДОСТУПНЫЕ КНОПКИ И ЦВЕТ ШРИФТА В НИХ.
 *
 * Пользователь: «Надо редактировать так же и недоступные для нажатия кнопки и
 * цвет шрифта в кнопках». У `disabled` кнопки браузер не присылает событий,
 * поэтому в правке атрибут снимается — иначе её не выбрать.
 *
 * Берём полный бак: кнопки заправки недоступны, а это ровно нужный случай.
 */
const full = { ...state, fuel: 9999 };
const w3 = boot({ state: JSON.stringify(full), log: [] });
await wait(900);
const d3 = w3.document;
const c3 = (el) => el.dispatchEvent(new w3.MouseEvent('click', { bubbles: true, cancelable: true }));
const a3 = (a, extra = {}) => [...d3.querySelectorAll(`[data-action="${a}"]`)]
  .find((b) => Object.entries(extra).every(([k, v]) => b.dataset[k] === String(v)));

c3(a3('tab', { tab: 'hangar' }));
await wait(300);
const dead = d3.querySelector('#content button[disabled]');
check('§132.3: в ангаре есть недоступная кнопка для проверки', dead !== null, dead?.textContent?.trim());

c3(a3('tab', { tab: 'log' }));
await wait(200);
c3(a3('dev-open'));
await wait(200);
c3(d3.querySelector('[data-action="dev-editor"]'));
await wait(200);
c3(d3.getElementById('dev-pencil'));
await wait(300);
c3(a3('tab', { tab: 'hangar' }));
await wait(300);

const dead2 = d3.querySelector('#content button[data-ui-disabled]');
check('§132.3: в правке недоступная кнопка оттаяла', dead2 !== null && dead2.disabled === false,
  `${dead2?.disabled} / ${dead2?.dataset.uiDisabled}`);
/*
 * §132.4: вид недоступной кнопки морозится.
 *
 * Пользователь (скриншот): «выбрал неактивную кнопку, но цвет текста в
 * редакторе там для активной». Значит в правке кнопка должна выглядеть так же
 * тускло, как в игре, — иначе и цвет в панели читается с живого вида.
 */
check('§132.3: и выглядит по-прежнему приглушённой', dead2?.dataset.uiDisabled === '1');
check('§132.4: приглушённость заморожена на самом элементе',
  parseFloat(dead2?.style.opacity ?? '1') < 0.6, dead2?.style.opacity);
check('§132.4: и она та же, что была у недоступной',
  dead2?.style.opacity === dead2?.dataset.uiDeadOpacity,
  `${dead2?.style.opacity} / ${dead2?.dataset.uiDeadOpacity}`);

c3(dead2);
await wait(150);
const p3 = d3.getElementById('ui-editor');
check('§132.3: недоступную кнопку можно выбрать', /Кнопка/.test(p3.textContent ?? ''),
  (p3.textContent ?? '').split('\n')[0].slice(0, 24));
check('§132.3: у кнопки есть цвет шрифта', !!p3.querySelector('[data-ui-prop="color"]'));
const hexOf = (rgb) => {
  const m = String(rgb).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return String(rgb).toLowerCase();
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
};
const shown = p3.querySelector('[data-ui-prop="color"][data-ui-kind="text-color"]').value;
check('§132.4: панель показывает настоящий цвет кнопки',
  shown.toLowerCase() === hexOf(w3.getComputedStyle(dead2).color),
  `${shown} / ${hexOf(w3.getComputedStyle(dead2).color)}`);
check('§132.4: в панели сказано, что кнопка недоступна',
  /недоступна/.test(p3.querySelector('.uied-note')?.textContent ?? ''),
  (p3.querySelector('.uied-note')?.textContent ?? '').slice(0, 40));

const color = p3.querySelector('[data-ui-prop="color"][data-ui-kind="text-color"]');
color.value = '#ffcc00';
color.dispatchEvent(new w3.Event('input', { bubbles: true }));
check('§132.3: цвет шрифта кнопки меняется',
  /255,\s*204,\s*0/.test(dead2.style.color) || dead2.style.color === '#ffcc00', dead2.style.color);

c3(d3.querySelector('[data-ui-act="done"]'));
await wait(300);
const dead3 = d3.querySelector('#content [data-action="refuel"][data-n]');
check('§132.3: после выхода кнопка снова недоступна', dead3?.disabled === true, String(dead3?.disabled));
check('§132.3: и цвет шрифта остался', /255,\s*204,\s*0/.test(dead3?.style.color ?? '') || dead3?.style.color === '#ffcc00',
  dead3?.style.color);
w3.close();

/*
 * §132.5: ЗАГОЛОВОК КАРТОЧКИ С ПИЛЮЛЕЙ И НИЗ ЭКРАНА.
 *
 * Пользователь: «У карточек типа c1 не могу редактировать заголовок (например
 * „Еда"). Так же если прокрутить список карточек до самого низа, то окно
 * редактора закрывает собой низ списка. Надо чтобы низ любого окна был привязан
 * к верху меню редактора».
 */
const w4 = boot({ state: JSON.stringify(state), log: [] });
await wait(900);
const d4 = w4.document;
const c4 = (el) => el.dispatchEvent(new w4.MouseEvent('click', { bubbles: true, cancelable: true }));
const a4 = (a, extra = {}) => [...d4.querySelectorAll(`[data-action="${a}"]`)]
  .find((b) => Object.entries(extra).every(([k, v]) => b.dataset[k] === String(v)));

c4(a4('tab', { tab: 'market' }));
await wait(300);
c4(a4('tab', { tab: 'log' }));
await wait(200);
c4(a4('dev-open'));
await wait(200);
c4(d4.querySelector('[data-action="dev-editor"]'));
await wait(200);
c4(d4.getElementById('dev-pencil'));
await wait(300);
c4(a4('tab', { tab: 'market' }));
await wait(400);

const title = [...d4.querySelectorAll('#content .name')].find((n) => /^\s*Еда/.test(n.textContent ?? ''));
check('§132.5: заголовок «Еда» на рынке есть', !!title, (title?.textContent ?? '').trim().slice(0, 20));
check('§132.5: у заголовка с пилюлей свой ключ', /\.t\d+$/.test(title?.dataset.uiKey ?? ''),
  title?.dataset.uiKey);

c4(title);
await wait(200);
const p4 = d4.getElementById('ui-editor');
const textField = p4.querySelector('[data-ui-prop="text"][data-ui-kind="text"]');
check('§132.5: нажатие на заголовок открывает «Строку текста»',
  /Строка текста/.test(p4.querySelector('.uied-head')?.textContent ?? ''),
  (p4.querySelector('.uied-head')?.textContent ?? '').slice(0, 24));
check('§132.5: в поле именно заголовок, без пилюли', textField?.value === 'Еда', textField?.value);

textField.value = 'Пища';
textField.dispatchEvent(new w4.Event('input', { bubbles: true }));
const after = d4.querySelector(`#content [data-ui-key="${title.dataset.uiKey}"]`);
check('§132.5: текст заголовка меняется', /Пища/.test(after?.textContent ?? ''),
  (after?.textContent ?? '').trim().slice(0, 24));
const chipBefore = title.querySelector('.chip')?.textContent;
check('§132.5: пилюля при этом цела и не изменилась',
  !!after?.querySelector('.chip') && after.querySelector('.chip').textContent === chipBefore,
  `${chipBefore} → ${after?.querySelector('.chip')?.textContent}`);

/*
 * Низ экрана. Панель в jsdom нулевой высоты, поэтому подставляем её размер:
 * проверяем не «сколько», а что отступ считается от верха панели.
 */
Object.defineProperty(p4, 'offsetHeight', { get: () => 320, configurable: true });
c4(title);
await wait(200);
check('§132.5: высота панели уходит в CSS-переменную',
  d4.body.style.getPropertyValue('--ui-editor-h').trim() === '320px',
  d4.body.style.getPropertyValue('--ui-editor-h').trim());
check('§132.5: низ экрана сдвигается отступом снизу',
  /\.ui-editing main\s*\{[^}]*padding-bottom:[^}]*--ui-editor-h/.test(html));

c4(d4.querySelector('[data-ui-act="done"]'));
await wait(300);
check('§132.5: после правки отступ снят', d4.body.style.getPropertyValue('--ui-editor-h').trim() === '0px',
  d4.body.style.getPropertyValue('--ui-editor-h').trim());
w4.close();

/*
 * §132.6: ПРАВКА ТЕКСТА — ЗАМЕНА КУСКА, А НЕ ТЕКСТ ЦЕЛИКОМ.
 *
 * Пользователь: «Когда я отредактировал этот текст (убрал слово „цена"), то
 * весь блок текста перестал меняться при выборе другой планеты». Проверяем
 * ровно это: убрали слово — и на другой планете блок живой.
 */
const w5 = boot({ state: JSON.stringify(state), log: [] });
await wait(900);
const d5 = w5.document;
const c5 = (el) => el.dispatchEvent(new w5.MouseEvent('click', { bubbles: true, cancelable: true }));
const a5 = (a, extra = {}) => [...d5.querySelectorAll(`[data-action="${a}"]`)]
  .find((b) => Object.entries(extra).every(([k, v]) => b.dataset[k] === String(v)));

c5(a5('tab', { tab: 'ship' }));
await wait(300);
c5(a5('tab', { tab: 'log' }));
await wait(200);
c5(a5('dev-open'));
await wait(200);
c5(d5.querySelector('[data-action="dev-editor"]'));
await wait(200);
c5(d5.getElementById('dev-pencil'));
await wait(300);
c5(a5('tab', { tab: 'ship' }));
await wait(400);

const info = [...d5.querySelectorAll('#content [data-ui-key]')]
  .find((n) => /\.t\d+$/.test(n.dataset.uiKey ?? '') && /цена/.test(n.textContent ?? ''));
check('§132.6: блок с ценой станции на месте', !!info, info?.dataset.uiKey);
c5(info);
await wait(200);
const p6 = d5.getElementById('ui-editor');
const field = p6.querySelector('[data-ui-prop="text"]');
check('§132.6: многострочный текст правится в textarea', field?.tagName === 'TEXTAREA', field?.tagName);

const liveBefore = field.value;
const withoutPrice = liveBefore.replace('цена ', '');
field.value = withoutPrice;
field.dispatchEvent(new w5.Event('input', { bubbles: true }));
const after1 = d5.querySelector(`#content [data-ui-key="${info.dataset.uiKey}"]`);
check('§132.6: слово «цена» убрано с экрана', !/цена/.test(after1.textContent ?? ''));
check('§132.6: остальной текст цел', /Преимущественно|Сельскохозяйственная|промышленная|Техуровень/.test(after1.textContent ?? ''),
  (after1.textContent ?? '').replace(/\s+/g, ' ').slice(0, 40));

const stored6 = JSON.parse(w5.localStorage.getItem(EDIT_KEY) ?? '{}');
const saved = stored6[Object.keys(stored6)[0]]?.[info.dataset.uiKey];
check('§132.6: в правке лежит замена, а не текст целиком',
  !!saved?.ops?.length && saved.text === undefined, JSON.stringify(saved?.ops));
check('§132.6: замена — именно слово «цена»', saved?.ops?.[0]?.from === 'цена ' && saved.ops[0].to === '',
  JSON.stringify(saved?.ops?.[0]));

// Вторая правка в той же сессии — считается от живого текста, а не от изменённого.
field.value = withoutPrice.replace('Станция', 'Стоянка');
field.dispatchEvent(new w5.Event('input', { bubbles: true }));
const after2 = d5.querySelector(`#content [data-ui-key="${info.dataset.uiKey}"]`);
check('§132.6: вторая правка тоже применяется', /Стоянка/.test(after2.textContent ?? ''),
  (after2.textContent ?? '').replace(/\s+/g, ' ').slice(-30));
check('§132.6: и «цена» по-прежнему убрана', !/цена/.test(after2.textContent ?? ''));

const editsJson = w5.localStorage.getItem(EDIT_KEY);
c5(d5.querySelector('[data-ui-act="done"]'));
await wait(300);
w5.close();

/*
 * Самая суть: та же сохранённая правка на ДРУГОЙ планете. Раньше здесь
 * показывался замороженный текст LAVE.
 */
const other = { ...state, system: 8 };
const w7 = boot({ state: JSON.stringify(other), log: [] }, editsJson);
await wait(900);
const d7 = w7.document;
// Вне правки ключей нет — ищем по структуре: тот же `.sub` с данными планеты.
const fresh = [...d7.querySelectorAll('#content .sub')].find((n) => /Техуровень/.test(n.textContent ?? ''));
check('§132.6: на другой планете блок на месте', !!fresh,
  (fresh?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 34));
check('§132.6: правка применилась на другой планете', /Стоянка/.test(fresh?.textContent ?? ''),
  (fresh?.textContent ?? '').replace(/\s+/g, ' ').slice(-24));
check('§132.6: и «цена» там тоже убрана', !/цена/.test(fresh?.textContent ?? ''));
check('§132.6: данные планеты обновились, а не замерли',
  (fresh?.textContent ?? '').replace(/\s+/g, ' ').trim() !==
    liveBefore.replace('цена ', '').replace('Станция', 'Стоянка').replace(/\s+/g, ' ').trim(),
  (fresh?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50));
const freshText = (fresh?.textContent ?? '').replace(/\s+/g, ' ').trim();
w7.close();

/*
 * Старый формат правки («текст целиком») переводится в замену на первой же
 * перерисовке — иначе прежние правки продолжали бы морозить блок.
 */
const legacy = JSON.stringify({ ship: { 'c0.t1': { text: freshText } } });
const w8 = boot({ state: JSON.stringify(other), log: [] }, legacy);
await wait(900);
const d8 = w8.document;
const migrated = JSON.parse(w8.localStorage.getItem(EDIT_KEY) ?? '{}').ship?.['c0.t1'];
check('§132.6: старая правка переведена в замену', !!migrated?.ops?.length && migrated.text === undefined,
  JSON.stringify(migrated?.ops));
check('§132.6: и текст на экране остался прежним',
  [...d8.querySelectorAll('#content .sub')].some((n) =>
    (n.textContent ?? '').replace(/\s+/g, ' ').trim() === freshText));
w8.close();

/*
 * §132.8: ТЕКСТ ПОД МОДЕЛЬЮ КОРАБЛЯ И МЕТКА СБОРКИ.
 *
 * Пользователь: «Так же залипает отредактированный текст под моделью моего
 * корабля» (не обновляется). Проверяем буквально: правим подпись под моделью,
 * покупаем другой корабль — подпись должна показать новый корабль.
 *
 * Система 3 выбрана потому, что на её верфи есть Cobra Mk III.
 */
const docked = { ...state, system: 3, cash: 9_000_000 };
const w9 = boot({ state: JSON.stringify(docked), log: [] });
await wait(900);
const d9 = w9.document;
const c9 = (el) => el.dispatchEvent(new w9.MouseEvent('click', { bubbles: true, cancelable: true }));
const a9 = (a, x = {}) => [...d9.querySelectorAll(`[data-action="${a}"]`)]
  .find((b) => Object.entries(x).every(([k, v]) => b.dataset[k] === String(v)));

c9(a9('tab', { tab: 'hangar' }));
await wait(400);
const caption = () => d9.querySelector('.ship-view .sub')?.textContent ?? '';
check('§132.8: подпись под моделью на месте', /Adder/.test(caption()), caption());

c9(a9('tab', { tab: 'log' }));
await wait(200);
c9(a9('dev-open'));
await wait(200);
c9(d9.querySelector('[data-action="dev-editor"]'));
await wait(200);
c9(d9.getElementById('dev-pencil'));
await wait(300);
c9(a9('tab', { tab: 'hangar' }));
await wait(400);

/*
 * §132.8: текст КНОПКИ тоже правится заменой. Иначе подпись с ценой
 * («Доплатить 120 000 CR») замерзала бы на одном числе.
 */
const pump = a9('refuel', { n: 10 });
c9(pump);
await wait(200);
const pBtn = d9.getElementById('ui-editor');
const fBtn = pBtn.querySelector('[data-ui-prop="text"]');
fBtn.value = 'Заправить';
fBtn.dispatchEvent(new w9.Event('input', { bubbles: true }));
const storedBtn = JSON.parse(w9.localStorage.getItem(EDIT_KEY) ?? '{}').hangar?.[pump.dataset.uiKey];
check('§132.8: подпись кнопки правится заменой',
  /Заправить/.test(pump.textContent ?? '') && !!storedBtn?.ops?.length && storedBtn.text === undefined,
  `${pump.textContent} / ${JSON.stringify(storedBtn?.ops)}`);

c9(d9.querySelector('.ship-view .sub'));
await wait(200);
const p9 = d9.getElementById('ui-editor');
check('§132.8: в панели видна метка сборки', /§132\.8/.test(p9.querySelector('.uied-build')?.textContent ?? ''),
  p9.querySelector('.uied-build')?.textContent);

const f9 = p9.querySelector('[data-ui-prop="text"]');
f9.value = f9.value.replace(' · ваш корабль в ангаре', '');
f9.dispatchEvent(new w9.Event('input', { bubbles: true }));
check('§132.8: подпись правится', caption() === 'Adder', caption());

c9(d9.querySelector('[data-ui-act="done"]'));
await wait(300);
c9(a9('ship-buy', { id: 'cobra3' }));
await wait(300);
c9(d9.querySelector('[data-action="ship-confirm"]'));
await wait(600);
check('§132.8: корабль куплен', d9.querySelector('#ship-model')?.dataset.ship === 'cobra3',
  d9.querySelector('#ship-model')?.dataset.ship);
check('§132.8: подпись обновилась под новый корабль', caption() === 'Cobra Mk III', caption());

/*
 * §132.8: «Сбросить всё» — чистка черновика вида в два нажатия.
 */
c9(d9.getElementById('dev-pencil'));
await wait(300);
c9(d9.querySelector('.ship-view .sub'));
await wait(200);
const all = d9.querySelector('[data-ui-act="reset-all"]');
check('§132.8: в панели есть «Сбросить всё»', all !== null);
c9(all);
await wait(100);
check('§132.8: первое нажатие только спрашивает', /Точно/.test(all.textContent ?? ''), all.textContent);
check('§132.8: и правки пока целы',
  Object.keys(JSON.parse(w9.localStorage.getItem(EDIT_KEY) ?? '{}').hangar ?? {}).length === 2,
  String(Object.keys(JSON.parse(w9.localStorage.getItem(EDIT_KEY) ?? '{}').hangar ?? {}).length));
c9(all);
await wait(300);
check('§132.8: второе нажатие стирает все правки',
  Object.keys(JSON.parse(w9.localStorage.getItem(EDIT_KEY) ?? '{}')).every(
    (k) => Object.keys(JSON.parse(w9.localStorage.getItem(EDIT_KEY))[k]).length === 0));
check('§132.8: и текст вернулся к живому', /Cobra Mk III · ваш корабль в ангаре/.test(caption()), caption());
w9.close();

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
