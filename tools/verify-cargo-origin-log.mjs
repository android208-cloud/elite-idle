/**
 * §98: журнал называет ПРОИСХОЖДЕНИЕ запрещёнки.
 *
 * Пользователь: «В журнале нет записей о происхождении запрещёнки».
 *
 * Проверяем в собранной игре: купленный запрещённый товар, взлёт — и в
 * журнале должна появиться запись, где назван и товар, и путь («куплено на
 * рынке»), а не только «статус вырос».
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const NARCOTICS = 6;

function save() {
  const state = {
    version: 3, galaxy: 1, system: 7, cash: 90000, fuel: 70, holdSpace: 18,
    cargo: Array(17).fill(0).map((_, i) => (i === NARCOTICS ? 2 : 0)),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    // §78: для старта патруля нужен полный комплект — иначе кнопка
    // выключена, и проверка журнала ничего не проверит.
    ship: { laser: 'military', missiles: 4, ecm: true, energyBomb: true,
            energyUnit: false, fuelScoops: false, dockingComputer: false, galacticHyperdrive: false, cargoBayExtended: false },
    kills: 5, legal: 0, encounter: null, combat: null, salvage: null,
    stats: { kills: 5, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0),
    // Груз куплен на рынке — так и должно быть записано.
    cargoOrigin: [{ commodity: NARCOTICS, amount: 2, added: 2, byPath: { bought: 2, salvage: 0, drifting: 0 } }],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [], settings: {} };
}

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
    w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(save()));
  },
});
const w = dom.window;
await new Promise((r) => setTimeout(r, 900));

const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const tabBtn = (id) => [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === id);

/*
 * Взлёт с контрабандой — тот самый момент, когда статус растёт.
 *
 * Кликнуть по карте в jsdom нельзя (канвас), поэтому идём через кнопку
 * «Патрулировать» на «Корабле»: она тоже взлёт и тоже поднимает статус
 * через `legalAfterLaunch`. Груз при этом не меняется — проверяем запись,
 * а не полёт.
 */
/*
 * Систему выбираем программным касанием по местной карте: у фикстурного
 * канваса нет размеров, поэтому подставляем его в центр экрана и бьём
 * ровно туда, где по расчёту карты лежит LAVE.
 *
 * `setPointerCapture` в jsdom нет — без заглушки `onMapTap` упадёт на
 * первой же строке после выбора.
 */
click(tabBtn('map'));
await new Promise((r) => setTimeout(r, 300));
const canvas = w.document.querySelector('canvas[data-local="1"]');
check('местная карта нарисована', !!canvas);
if (canvas) {
  w.Element.prototype.setPointerCapture = () => {};
  const cw = Number(canvas.getAttribute('width')) || 320;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: cw, height: cw, right: cw, bottom: cw, x: 0, y: 0 });
  Object.defineProperty(canvas, 'clientWidth', { value: cw, configurable: true });
  // LAVE стоит в начале координат галактики; карта центрируется на текущей
  // системе, поэтому корабль здесь — ровно в середине холста.
  /*
   * Событие шлём на РЕБЁНКА холста: обработчик висит на `#content` через
   * делегирование и смотрит `ev.target.id`. Прямой dispatch на сам холст
   * в jsdom даёт target === canvas, но после первой же перерисовки узел
   * уничтожается — поэтому каждый раз берём свежий.
   *
   * `pointerdown` в jsdom есть только как `PointerEvent`; кликаем по
   * центру, где на местной карте стоит корабль (LAVE).
   */
  /*
   * Бьём не по центру: там стоит LAVE, система стоянки, и «Перелёт» в неё
   * выключен. DISO в 36 св. годах — достижимо на полном баке. Координата
   * посчитана по той же формуле, что в `localView`: canvas 320, отступ 10,
   * радиус = бак/4 · 1.15.
   */
  const hit = { x: 93, y: 164 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = w.document.querySelector('canvas[data-local="1"]');
    if (!fresh) break;
    fresh.getBoundingClientRect = () => ({ left: 0, top: 0, width: cw, height: cw, right: cw, bottom: cw, x: 0, y: 0 });
    Object.defineProperty(fresh, 'clientWidth', { value: cw, configurable: true });
    fresh.dispatchEvent(new w.PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: hit.x, clientY: hit.y }));
    await new Promise((r) => setTimeout(r, 150));
    if (w.document.querySelector('[data-action="jump"]:not([disabled])')) break;
  }
  await new Promise((r) => setTimeout(r, 300));
}
/*
 * §82: на карте кнопки прыжка нет — она на «Корабле». Карта решает КУДА,
 * корабль решает КОГДА. Возвращаемся на «Корабль» и летим оттуда.
 */
const chosen = /В пути:/.test(w.document.getElementById('content').textContent);
check('цель выбрана на карте', chosen);
click(tabBtn('ship'));
await new Promise((r) => setTimeout(r, 300));
const jump = w.document.querySelector('[data-action="jump"]');
check('«Перелёт» доступен после выбора цели', !!jump && !jump.disabled, jump?.textContent.trim());
if (jump && !jump.disabled) {
  click(jump);
  await new Promise((r) => setTimeout(r, 500));
}

// Открываем журнал и разворачиваем его.
const logTab = tabBtn('log');
click(logTab);
await new Promise((r) => setTimeout(r, 300));
const toggle = w.document.querySelector('[data-action="log-toggle"]');
if (toggle) { click(toggle); await new Promise((r) => setTimeout(r, 300)); }
const logText = w.document.querySelector('.log')?.textContent ?? w.document.getElementById('content').textContent;

check('журнал называет товар', /Наркотики/.test(logText), logText.slice(0, 120));
check('журнал называет путь', /куплено на рынке/.test(logText));
check('журнал называет причину роста статуса', /запрещённ/i.test(logText));
check('записи «просто статус вырос» больше нет как единственной',
  !/^[^]*Контрабанда в трюме: правовой статус[^]*$/.test(logText) || /куплено на рынке/.test(logText));

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
w.close();
process.exit(bad ? 1 : 0);
