/**
 * Экран не должен сам прокручиваться при выборе планеты на карте.
 *
 * Пользователь: «если на мини карте выбрать планету, то экран сам
 * скроллится». Причин может быть две, и обе проверяются здесь:
 *
 *  1. РАЗМЕТКА. render() целиком пересобирает innerHTML. Если в этот
 *     момент холсты ещё без высоты (в браузере у <canvas> по умолчанию
 *     150 px), контент короче — и браузер обрезает scrollTop по
 *     тогдашнему максимуму. Поэтому прокрутка возвращается ПОСЛЕ
 *     drawMap(), а не до него.
 *
 *  2. ЖЕСТ. Холст пересоздаётся прямо под пальцем, браузеру не к чему
 *     привязать остаток касания — и он трактует его как прокрутку.
 *     Поэтому на pointerdown по карте стоит preventDefault.
 *
 * jsdom не прокручивает и не жестикулирует, поэтому поведение браузера
 * моделируется: scrollTop при присваивании обрезается по фактической
 * высоте контента, а высота холста без явной — 150 px, как в браузере.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///d/scroll.html', virtualConsole: vc });
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = () => ({
  setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
  arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
  measureText: (t) => ({ width: String(t).length * 6 }),
  set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
});
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
  value() { return { left: 0, top: 0, width: 360, height: 360, right: 360, bottom: 360, x: 0, y: 0 }; }, configurable: true,
});

/** Высота контента: холст без style.height считается 150, как в браузере. */
const DEFAULT_CANVAS_H = 150;
function contentHeight(el) {
  if (el.tagName === 'CANVAS') {
    const h = parseInt(el.style.height, 10);
    return Number.isFinite(h) && h > 0 ? h : DEFAULT_CANVAS_H;
  }
  let total = 0;
  for (const child of el.children) total += contentHeight(child);
  if (el.tagName === 'DIV') total += 40; // отступы и паддинги карточки
  return total;
}

const VIEW_H = 600;
let scrollTop = 0;
const shrinks = [];
Object.defineProperty(window.Element.prototype, 'scrollTop', {
  get() { return scrollTop; },
  set(v) {
    const max = Math.max(0, contentHeight(window.document.getElementById('content')) - VIEW_H);
    const next = Math.min(Math.max(0, v), max);
    if (next < v) shrinks.push({ requested: v, got: next, max });
    scrollTop = next;
  },
  configurable: true,
});

window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;
await new Promise((r) => setTimeout(r, 700));

const clickTab = (id) => [...window.document.querySelectorAll('[data-action="tab"]')].find(t => t.dataset.tab === id)
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
clickTab('map');
await new Promise((r) => setTimeout(r, 300));

// Игрок прокрутил карту вниз — настолько, насколько это возможно.
const heightBefore = contentHeight(window.document.getElementById('content'));
const maxBefore = Math.max(0, heightBefore - VIEW_H);
scrollTop = maxBefore;
const startScroll = scrollTop;

let defaultPrevented = false;
const cv = window.document.getElementById('map-local');
const ev = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 104, clientY: 154 });
cv.dispatchEvent(ev);
defaultPrevented = ev.defaultPrevented;
await new Promise((r) => setTimeout(r, 300));

const heightAfter = contentHeight(window.document.getElementById('content'));
const maxAfter = Math.max(0, heightAfter - VIEW_H);

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

check('жест по карте отменён (не превратится в прокрутку)', defaultPrevented);
check('перерисовка не обрезала прокрутку', shrinks.length === 0,
  shrinks.length ? shrinks.map(s => `${s.requested}→${s.got}`).join(', ') : `высота ${heightBefore} → ${heightAfter}`);
// Прокрутка не должна уехать вверх. Если контент законно стал короче,
// уменьшение до нового максимума — не баг: дальше прокручивать некуда.
const expected = Math.min(startScroll, maxAfter);
check('прокрутка осталась на месте', Math.abs(scrollTop - expected) <= 1,
  `было ${startScroll}, стало ${scrollTop}, предел теперь ${maxAfter}`);

process.exit(bad ? 1 : 0);
