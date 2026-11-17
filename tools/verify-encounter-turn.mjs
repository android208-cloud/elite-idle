/**
 * Модель встреченного корабля вращается (§71).
 *
 * Проверяется на собранной игре с поддельным холстом: кадр = вызов
 * clearRect. Две копии игры в одном origin нужны, чтобы подложить
 * встречу: ждать случайную — минуты. Первая копия создаёт сохранение,
 * вторая стартует с ним.
 *
 * url — https, а не file://: на file:// источник «opaque» и
 * localStorage бросает SecurityError (игра это переживает, но
 * сохранение подложить некуда).
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const SAVE_KEY = 'elite-idle-save-v1';
const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();

/** Одна копия игры; frameCount — общий счётчик отрисовок холстов. */
let frames = 0;
function launch(storageSeed) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://elite.test/',
    virtualConsole: vc,
    /*
     * ВАЖНО: beforeParse, а не запись после создания.
     *
     * Каждая JSDOM получает СВОЁ хранилище (в отличие от настоящего
     * браузера, где origin общий). Запись после new JSDOM попадает в
     * объект, который игра к этому моменту уже прочитала — и load()
     * видит null. beforeParse выполняется до скриптов страницы.
     */
    beforeParse(w) {
      if (storageSeed) {
        for (const [k, v] of Object.entries(storageSeed)) w.localStorage.setItem(k, v);
      }
    },
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => ({
    setTransform(){}, clearRect(){ frames++; }, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
    arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
    measureText: (t) => ({ width: String(t).length * 6 }),
    set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = clearTimeout;
  return dom;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

// --- Копия 1: создаёт сохранение -------------------------------------
const first = launch(null);
await wait(800);
const rawSave = first.window.localStorage.getItem(SAVE_KEY);
if (!rawSave) {
  console.log('❌ игра не создала сохранение за время старта');
  process.exit(1);
}

// --- Готовим встречу --------------------------------------------------
const save = JSON.parse(rawSave);
const gs = JSON.parse(save.state);
const now = Date.now();
gs.encounter = { role: 'pirate', enemyId: 'cobra3', detectedAt: now, resolveAt: now + 600_000, outcome: 'leave' };
gs.flight = {
  from: gs.system,
  to: (gs.system + 1) % 256,
  departAt: now,
  arriveAt: now + 600_000,
  remainingBaseMs: 600_000,
  elapsedBaseMs: 0,
  dueAt: now,
  pending: [],
};
save.state = JSON.stringify(gs);

// --- Копия 2: стартует со встречей -----------------------------------
frames = 0;
const second = launch({ [SAVE_KEY]: JSON.stringify(save) });
await wait(300);
const encCanvas = second.window.document.querySelector('canvas.enc-model');
check('модель встречи есть на экране', !!encCanvas, encCanvas?.dataset.ship ?? 'нет холста');

const before = frames;
await wait(700);
const drawn = frames - before;
check('модель вращается', drawn >= 10, `${drawn} кадров за 0.7 с`);

// --- Остановка: экран сменился, анимация должна прекратиться --------
const tabShip = [...second.window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'log');
tabShip?.dispatchEvent(new second.window.MouseEvent('click', { bubbles: true }));
await wait(200);
const stopFrom = frames;
await wait(500);
const afterSwitch = frames - stopFrom;
check('после ухода с экрана кадры прекращаются', afterSwitch === 0, `кадров ${afterSwitch}`);

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
