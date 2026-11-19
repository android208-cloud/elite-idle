/**
 * §113: экран для разработчика.
 *
 * Пользователь попросил отдельное меню по нажатию: «показать линии
 * маршрута», «показать пилота на маршруте» и «лог файл» — полная выгрузка
 * для отладки.
 *
 * Что проверяем:
 *   - из настроек открывается отдельный экран, из него есть возврат;
 *   - на карте есть И линии маршрутов, И треугольники пилотов;
 *   - выключение «линий» убирает линии, но не пилотов;
 *   - выключение «пилота» убирает и треугольники;
 *   - обе галочки сохраняются в настройках;
 *   - «Скачать лог» отдаёт файл `elite-idle-debug-…json` с полной
 *     отладкой: состояние, настройки, журнал и расшифровка флота.
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
const now = Date.now();

function pilot(id, role, from, to) {
  return {
    id, name: `Пилот ${id}`, ship: 'adder', home: from, route: { from, to },
    nextRunAt: now + 2 * 3600_000 + id * 600_000, role, runs: 2, failures: 0,
  };
}

function save(pilots) {
  const state = {
    version: 4, galaxy: 1, system: LAVE, cash: 123450, fuel: 70, holdSpace: 8,
    cargo: Array(17).fill(0), market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'adder', laser: 'pulse', missiles: 1, ecm: true, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false,
    },
    kills: 128, legal: 0, encounter: null, combat: null, salvage: null,
    pilots, nextPilotId: pilots.length + 1,
    stats: {
      kills: 128, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0,
      jumps: 4, dockings: 2, dockingFails: 0, patrols: 0, raided: 0,
      // §114: доход флота копится в статистике — проверяем, что она его показывает.
      pilotIncome: 1234,
    },
    cargoBasis: Array(17).fill(0), cargoOrigin: [], escapeRoute: [], escapeStatus: -1,
    careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [{ at: 1, text: 'проба: строка журнала' }], settings: {} };
}

const strokes = [];
const fills = [];
const blobs = [];
let anchorDownload = null;

function boot(saved) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/',
    virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = function () {
        const canvas = this;
        const ctx = {
          _pts: [], _last: null, _style: '', _width: 1,
          setTransform() {}, clearRect() {}, save() {}, restore() {}, clip() {},
          translate() {}, rotate() {}, scale() {},
          fillRect() {}, strokeRect() {}, fillText() {}, setLineDash() {},
          beginPath() { ctx._pts = []; ctx._last = null; },
          closePath() {},
          moveTo(x, y) { ctx._last = { x, y }; ctx._pts.push({ x, y, m: 1 }); },
          lineTo(x, y) { if (ctx._last) ctx._pts.push({ x, y }); ctx._last = { x, y }; },
          arc(x, y, r) { ctx._pts.push({ x, y, r, arc: 1 }); },
          stroke() {
            const segs = [];
            let prev = null;
            for (const p of ctx._pts) {
              if (p.arc) continue;
              if (p.m) { prev = p; continue; }
              if (prev) segs.push([prev.x, prev.y, p.x, p.y]);
              prev = p;
            }
            strokes.push({ canvas: canvas.id, style: ctx._style, width: ctx._width, segs });
          },
          fill() {
            if (ctx._pts.some((p) => p.arc)) return; // круги систем не считаем
            fills.push({ canvas: canvas.id, style: ctx._style, pts: ctx._pts.slice() });
          },
          measureText: (t) => ({ width: String(t).length * 6 }),
          createLinearGradient: () => ({ addColorStop() {} }),
          set lineWidth(v) { ctx._width = v; }, get lineWidth() { return ctx._width; },
          set strokeStyle(v) { ctx._style = v; }, get strokeStyle() { return ctx._style; },
          set fillStyle(v) { ctx._style = v; }, get fillStyle() { return ctx._style; },
          set font(v) {}, set textAlign(v) {}, set textBaseline(v) {}, set lineJoin(v) {},
          set globalAlpha(v) {}, set lineCap(v) {}, set shadowBlur(v) {}, set shadowColor(v) {},
        };
        return ctx;
      };
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      w.cancelAnimationFrame = clearTimeout;
      w.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:fake'; };
      w.URL.revokeObjectURL = () => {};
      // Скачивание: запоминаем имя файла, сам клик не эмулируем.
      w.HTMLAnchorElement.prototype.click = function () { anchorDownload = this.download; };
      w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(saved));
    },
  });
  return dom.window;
}

const ROLES = ['#4fd8c4', '#ffd37a', '#ff8a80', '#8fb6ff'];
const lanes = () => strokes.filter((s) => s.canvas === 'map-overview' && ROLES.includes(s.style) && s.segs.length === 1);
/* §114: треугольники — только на местной карте; на общей их нет. */
const markers = () => fills.filter((f) => f.canvas === 'map-local' && ROLES.includes(f.style) && f.pts.length === 3);
const overviewMarkers = () => fills.filter((f) => f.canvas === 'map-overview' && ROLES.includes(f.style) && f.pts.length === 3);

const w = boot(save([
  pilot(1, 'trader', LAVE, REORTE),
  pilot(2, 'smuggler', LAVE, 148),
  pilot(3, 'pirate', REORTE, 148),
]));

await new Promise((r) => w.addEventListener('load', r, { once: true }));
await new Promise((r) => setTimeout(r, 600));
const d = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const go = async (name) => {
  click([...d.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === name));
  await new Promise((r) => setTimeout(r, 250));
};

/* ---------- карта до всякой отладки ---------- */
await go('map');
check('§112: линии маршрутов есть', lanes().length >= 3, String(lanes().length));
check('§114: на общей карте меток пилотов НЕТ', overviewMarkers().length === 0, String(overviewMarkers().length));
check('§113: на местной карте пилот — треугольник', markers().length >= 1, String(markers().length));
check('треугольник указывает направление (три точки, не круг)', markers().every((m) => m.pts.length === 3));

/* ---------- §114: доход флота в статистике ---------- */
await go('log');
const statsText = d.getElementById('content').textContent.replace(/\s+/g, ' ');
check('§114: в статистике есть «Доход флота»', /Доход флота/.test(statsText), statsText.slice(0, 120));
check('§114: доход флота показан в кредитах', /Доход флота\s*123\.4 CR/.test(statsText),
  statsText.match(/Доход флота[^А-Я]{0,12}/)?.[0] ?? 'нет');

/* ---------- экран отладки ---------- */
await go('log');
const devBtn = d.querySelector('[data-action="dev-open"]');
check('в настройках есть вход «Для разработчика»', Boolean(devBtn));
click(devBtn);
await new Promise((r) => setTimeout(r, 250));
check('открылся отдельный экран', d.getElementById('title').textContent === 'Отладка', d.getElementById('title').textContent);
const devText = d.getElementById('content').textContent.replace(/\s+/g, ' ');
check('на экране переключатель линий', /Линии маршрутов/.test(devText));
check('на экране переключатель пилота', /Пилот на маршруте/.test(devText));
check('на экране выгрузка лога', /Скачать лог/.test(devText) && /Лог файла/.test(devText));
check('есть возврат', Boolean(d.querySelector('[data-action="dev-close"]')));

/* ---------- галочка «линии» ---------- */
const setSelect = async (key, value) => {
  const sel = d.querySelector(`select[data-action="setting"][data-key="${key}"]`);
  sel.value = value;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
};
await go('log');
click(d.querySelector('[data-action="dev-open"]'));
await new Promise((r) => setTimeout(r, 200));
await setSelect('devRoutes', 'off');
const stored = JSON.parse(w.localStorage.getItem('elite-idle-save-v1'));
check('«линии» выключены и сохранены', stored.settings.devRoutes === false, String(stored.settings.devRoutes));
strokeReset();
fillReset();
await go('map');
check('линий больше нет', lanes().length === 0, String(lanes().length));
check('а пилоты остались', markers().length >= 1, String(markers().length));

/* ---------- галочка «пилот» ---------- */
await go('log');
click(d.querySelector('[data-action="dev-open"]'));
await new Promise((r) => setTimeout(r, 200));
await setSelect('devPilots', 'off');
fillReset();
await go('map');
check('треугольников больше нет', markers().length === 0 && overviewMarkers().length === 0, String(markers().length));

/* ---------- §119: отдых пилота ---------- */
await go('log');
click(d.querySelector('[data-action="dev-open"]'));
await new Promise((r) => setTimeout(r, 250));
const restOptions = (() => {
  const sel = d.querySelector('select[data-action="setting"][data-key="pilotRestMs"]');
  return sel ? [...sel.options] : null;
})();
check('§119: в отладке есть отдых пилота', Boolean(restOptions));
check('§119: от 1 минуты до 3 часов', restOptions
  && restOptions[0].textContent === '1 мин' && restOptions[restOptions.length - 1].textContent === '3 часа',
  restOptions ? `${restOptions[0].textContent} … ${restOptions[restOptions.length - 1].textContent}` : '');

// Сколько пилоту осталось до возвращения — до смены отдыха.
const leftBefore = (() => {
  const raw = JSON.parse(w.localStorage.getItem('elite-idle-save-v1'));
  const st = JSON.parse(raw.state);
  return st.pilots[0].nextRunAt - Date.now();
})();
await setSelect('pilotRestMs', String(60 * 60_000));
const restStored = JSON.parse(w.localStorage.getItem('elite-idle-save-v1'));
check('§119: час отдыха сохранён', restStored.settings.pilotRestMs === 3_600_000, String(restStored.settings.pilotRestMs));
check('§119: смена записана в журнал', /Отдых пилота: 2 ч → 1 ч/.test(d.getElementById('content').textContent)
  || /Отдых пилота: 2 ч → 1 ч/.test(JSON.stringify(restStored.log)),
  JSON.stringify(restStored.log?.[0]?.text ?? '').slice(0, 60));

const leftAfter = (() => {
  const st = JSON.parse(JSON.parse(w.localStorage.getItem('elite-idle-save-v1')).state);
  return st.pilots[0].nextRunAt - Date.now();
})();
// Пересчёт по доле цикла: отдых 2 ч → 1 ч сокращает остаток примерно на треть
// (цикл 2.84 ч → 1.84 ч). Точные числа зависят от расстояния, поэтому
// проверяем порядок: остаток стал заметно меньше, но не обнулился.
check('§119: назначенные рейсы пересчитаны', leftAfter > 0 && leftAfter < leftBefore,
  `${Math.round(leftBefore / 60000)} мин → ${Math.round(leftAfter / 60000)} мин`);

// Возвращаем два часа: дальше проверяется лог, а он пишет настройки.
await setSelect('pilotRestMs', String(120 * 60_000));

/* ---------- возврат и лог ---------- */
await go('log');
click(d.querySelector('[data-action="dev-open"]'));
await new Promise((r) => setTimeout(r, 250));
click(d.querySelector('[data-action="dev-close"]'));
await new Promise((r) => setTimeout(r, 250));
check('«Назад» возвращает в журнал', d.getElementById('title').textContent === 'Журнал', d.getElementById('title').textContent);

click(d.querySelector('[data-action="dev-open"]'));
await new Promise((r) => setTimeout(r, 250));
click(d.querySelector('[data-action="dev-log"]'));
await new Promise((r) => setTimeout(r, 300));
check('файл назван debug-…json', /^elite-idle-debug-[a-z0-9-]+-\d+cr-\d{4}-\d{2}-\d{2}\.json$/.test(anchorDownload ?? ''), String(anchorDownload));
check('файл действительно отдан', blobs.length === 1, String(blobs.length));

let parsed = null;
try {
  parsed = JSON.parse(await blobs[0].text());
} catch (e) {
  parsed = null;
}
check('это валидный JSON', parsed !== null);
check('в нём полное состояние', parsed && parsed.state && parsed.state.pilots.length === 3);
check('в нём настройки', parsed && parsed.settings && parsed.settings.devPilots === false);
check('в нём журнал', parsed && Array.isArray(parsed.log) && parsed.log.length >= 1);
check('в нём среда браузера', parsed && parsed.env && typeof parsed.env.userAgent === 'string');
check('в нём расшифровка флота', parsed && parsed.fleet && parsed.fleet.pilotList.length === 3
  && parsed.fleet.pilotList.every((p) => p.income >= 0 && p.cycleMs > 0));
check('файл говорит, что это debug', parsed && parsed.kind === 'debug');
check('после скачивания экран отчитался', /Лог сохранён/.test(d.getElementById('content').textContent));

function strokeReset() { strokes.length = 0; }
function fillReset() { fills.length = 0; }

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
w.close();
process.exit(bad ? 1 : 0);
