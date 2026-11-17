/** Проверяет: pointerdown на карте выбирает систему, скролл не сбрасывается. */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const errors = [];
const vc = new VirtualConsole().on('jsdomError', (e) => errors.push(String(e)));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///d/g.html', virtualConsole: vc });
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = () => ({
  setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
  arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
  measureText: (t) => ({ width: t.length * 6 }),
  set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){},
  set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
});
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return 360; }, configurable: true });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 700));
const mapTab = [...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'map');
mapTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 250));

const content = window.document.getElementById('content');
const local = window.document.getElementById('map-local');
console.log('=== малая карта ===');
console.log('холст:', local ? 'есть ✅' : 'НЕТ ❌');

// Прокручиваем вниз, потом кликаем по карте
content.scrollTop = 200;
console.log('scrollTop до клика:', content.scrollTop);

local.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 180, clientY: 180 }));
await new Promise((r) => setTimeout(r, 200));
console.log('scrollTop после клика:', content.scrollTop, content.scrollTop === 200 ? 'сохранён ✅' : 'СБРОШЕН ❌');

const cards = [...window.document.querySelectorAll('.card')];
const info = cards[cards.length - 1].textContent.replace(/\s+/g, ' ').trim();
console.log('выбрано:', info.slice(0, 30));
console.log('ошибки:', errors.length ? errors[0].slice(0, 90) : 'нет ✅');
process.exit(0);
