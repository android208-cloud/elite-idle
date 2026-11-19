/**
 * §112: маршруты пилотов на карте.
 *
 * Идея: маршрут пилота — это ПАРА СИСТЕМ, и вопрос про него всегда один:
 * «а где он летает?». В карточке ответ надо читать по строкам, на карте
 * он виден сразу.
 *
 * Что проверяем:
 *   - линия между двумя системами рисуется цветом роли;
 *   - полицейский патруль — кольцо вокруг системы (у него from === to,
 *     линии быть не может);
 *   - два пилота на одном маршруте дают ОДНУ линию потолще, а не две;
 *   - пилот без маршрута линий не даёт;
 *   - легенда под общей картой называет роли, которые сейчас в рейсе.
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
const QUQUOR = 148; // одна из соседних систем

/** Пилот в рейсе. */
const pilot = (id, role, from, to, extra = {}) => ({
  id, name: `Пилот ${id}`, ship: 'adder', home: from, route: { from, to },
  // Рейс «далеко в будущем»: досчёт флота не должен трогать пилотов, пока
  // проверка смотрит на карту. Иначе пират успевает погибнуть, а патрульный
  // — отработать тысячи рейсов ещё до первого кадра.
  nextRunAt: Date.now() + 1e9, role, runs: 3, failures: 0, ...extra,
});

function save({ pilots, nextPilotId = 9 }) {
  const state = {
    version: 4, galaxy: 1, system: LAVE, cash: 200000, fuel: 60, holdSpace: 8,
    cargo: Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'adder', laser: 'pulse', missiles: 1, ecm: true, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false,
    },
    kills: 128, legal: 0, encounter: null, combat: null, salvage: null,
    pilots, nextPilotId,
    stats: { kills: 128, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [], settings: {} };
}

/**
 * Кисть, которая запоминает ВСЁ, что нарисовано: цвет обводки, ширину,
 * отрезки и кольца. Игре этого хватает — карта рисуется одной проходкой.
 */
function boot(saved) {
  const strokes = [];
  const arcs = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/',
    virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = function () {
        const canvasId = this.id || 'canvas';
        const ctx = {
          _pts: [], _last: null,
          setTransform() {}, clearRect() {}, save() {}, restore() {},
          clip() {}, fillRect() {}, strokeRect() {}, fillText() {},
          beginPath() { ctx._pts = []; ctx._last = null; },
          closePath() {},
          moveTo(x, y) { ctx._last = { x, y }; ctx._pts.push({ x, y, m: 1 }); },
          lineTo(x, y) {
            if (ctx._last) ctx._pts.push({ x, y });
            ctx._last = { x, y };
          },
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
            const ring = ctx._pts.find((p) => p.arc);
            strokes.push({ canvas: canvasId, style: ctx.strokeStyle, width: ctx.lineWidth, segs, ring });
            if (ring) arcs.push({ x: ring.x, y: ring.y, r: ring.r, style: ctx.strokeStyle, canvas: canvasId });
          },
          fill() {
            const ring = ctx._pts.find((p) => p.arc);
            if (ring) arcs.push({ x: ring.x, y: ring.y, r: ring.r, style: ctx.fillStyle });
          },
          setLineDash() {}, measureText: (t) => ({ width: String(t).length * 6 }),
          createLinearGradient: () => ({ addColorStop() {} }),
          _style: '', _width: 1,
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
      w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(saved));
    },
  });
  const w = dom.window;
  return { w, strokes, arcs };
}

const COLOR = { trader: '#4fd8c4', smuggler: '#ffd37a', pirate: '#ff8a80', police: '#8fb6ff' };

const data = save({
  pilots: [
    pilot(1, 'trader', LAVE, REORTE),
    pilot(2, 'smuggler', LAVE, QUQUOR),
    pilot(3, 'pirate', REORTE, QUQUOR),
    pilot(4, 'police', LAVE, LAVE), // патруль: своя система
    pilot(5, 'trader', LAVE, REORTE), // второй на том же маршруте
    { ...pilot(6, 'trader', LAVE, REORTE), route: null }, // стоит в ангаре
  ],
});

const { w, strokes, arcs } = boot(data);
await new Promise((r) => w.addEventListener('load', r, { once: true }));
await new Promise((r) => setTimeout(r, 600));

const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
click([...w.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'map'));
await new Promise((r) => setTimeout(r, 400));

// Обе карты рисуют одно и то же, поэтому считаем только общую: на местной
// часть маршрутов просто не видна (оба конца вне окна).
const OV = 'map-overview';
const lines = strokes.filter((s) => s.canvas === OV && s.segs.length === 1);
const trader = lines.filter((s) => s.style === COLOR.trader);
const smuggler = lines.filter((s) => s.style === COLOR.smuggler);
const pirate = lines.filter((s) => s.style === COLOR.pirate);
const police = strokes.filter((s) => s.canvas === OV && s.style === COLOR.police);

check('линия торговца нарисована', trader.length >= 1, String(trader.length));
check('линия контрабандиста нарисована', smuggler.length >= 1, String(smuggler.length));
check('линия пирата нарисована', pirate.length >= 1, String(pirate.length));

// Два торговца на одном маршруте — одна линия, а не две.
check('два пилота на одном маршруте дают одну линию',
  trader.length === smuggler.length && trader.length === pirate.length,
  `торговец ${trader.length}, контрабандист ${smuggler.length}, пират ${pirate.length}`);
check('линия толще за одного пилота', trader[0].width > 1.2, String(trader[0].width));

// Патруль — кольцо вокруг своей системы.
const patrolRing = police.find((s) => s.ring && s.ring.r > 4);
check('патруль нарисован кольцом', Boolean(patrolRing), patrolRing ? `r=${patrolRing.ring?.r}` : 'нет');
check('у патруля нет линии между системами', police.every((s) => s.segs.length === 0));

// Легенда.
const text = w.document.getElementById('content').textContent.replace(/\s+/g, ' ');
check('легенда называет роли', /Маршруты пилотов: .*торговец/.test(text) && /контрабандист/.test(text) && /пират/.test(text), text.slice(0, 160));
check('легенда говорит про пилота без маршрута', /без маршрута: 1/.test(text), text.match(/без маршрута: \d+/)?.[0] ?? 'нет');
check('легенда цветная', /color:#4fd8c4/i.test(w.document.getElementById('content').innerHTML));

// Пилот без маршрута не даёт лишних линий: торговых ровно по одной на маршрут.
check('лишних линий нет', trader.length === 1, String(trader.length));

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
w.close();
process.exit(bad ? 1 : 0);
