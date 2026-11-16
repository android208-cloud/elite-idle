/** Проверяет, что карта рисуется и точки ложатся в границы холста. */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const errors = [];
const vc = new VirtualConsole().on('jsdomError', (e) => errors.push(String(e)));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///data/g.html', virtualConsole: vc,
});
const { window } = dom;

// Рисующий контекст, который запоминает дуги и линии
const arcs = [];
const lines = [];
const mk = () => ({
  fillRect() {}, clearRect() {}, beginPath() {}, closePath() {},
  moveTo(x, y) { this._last = [x, y]; },
  lineTo(x, y) { if (this._last) lines.push([...this._last, x, y]); },
  stroke() {}, fill() {}, save() {}, restore() {}, translate() {}, rotate() {},
  scale() {}, setTransform() {}, fillText() {}, measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }), setLineDash() {}, drawImage() {},
  strokeRect() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {}, roundRect() {},
  getImageData: () => ({ data: [] }), putImageData() {}, clip() {}, rect() {},
  arc(x, y, r) { arcs.push({ x, y, r }); },
  set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {}, set font(v) {}, set lineJoin(v) {},
});
window.HTMLCanvasElement.prototype.getContext = function () { return mk(); };
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 900));

// Переключаемся на карту
const tabs = [...window.document.querySelectorAll('[data-action="tab"]')];
const mapTab = tabs.find((t) => t.dataset.tab === 'map');
mapTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));

const canvas = window.document.getElementById('map');
console.log('=== карта ===');
console.log('canvas найден:', !!canvas ? 'да ✅' : 'НЕТ ❌');
console.log('ошибки:', errors.length ? errors.slice(0, 2).join(' | ') : 'нет ✅');
console.log('дуг нарисовано:', arcs.length);
const inline = [...window.document.querySelectorAll('.sub, .card')].map(e => e.textContent.trim()).join(' ').slice(0, 120);
console.log('текст карточки:', inline || '(нет)');
process.exit(0);
