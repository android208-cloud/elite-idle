/** Проверяет обе карты: общую горизонтальную и местную квадратную. */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const errors = [];
const labels = [];
let arcs = 0;
const vc = new VirtualConsole().on('jsdomError', (e) => errors.push(String(e)));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///d/g.html', virtualConsole: vc });
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = function () {
  let inPath = false;
  return {
    setTransform() {}, clearRect() {}, beginPath() { inPath = true; }, closePath() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {}, save() {}, restore() {},
    arc() { if (inPath) arcs++; }, setLineDash() {}, strokeRect() {},
    fillText(t, x, y) { labels.push({ t, x, y }); },
    measureText(t) { return { width: t.length * 6.2 }; },
    set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {}, set font(v) {},
    set textAlign(v) {}, set textBaseline(v) {}, set lineJoin(v) {},
  };
};
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 800));
const tab = [...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'map');
tab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));

const ov = window.document.getElementById('map-overview');
const lo = window.document.getElementById('map-local');
console.log('=== структура ===');
console.log('общая карта (map-overview):', ov ? 'да ✅' : 'НЕТ ❌');
console.log('местная карта (map-local):', lo ? 'да ✅' : 'НЕТ ❌');
console.log('общая выше местной:', ov && lo ? (ov.compareDocumentPosition(lo) & 4 ? 'да ✅' : 'НЕТ ❌') : '—');
console.log('=== ошибки ===');
console.log(errors.length ? errors.slice(0, 2).join(' | ') : 'нет ✅');
console.log('=== подписи ===');
console.log('всего нарисовано:', labels.length);
const names = labels.map(l => l.t);
console.log('примеры:', names.slice(0, 8).join(', '));
// Проверяем, что подписи не налезают
let overlap = 0;
for (let i = 0; i < labels.length; i++) for (let j = i+1; j < labels.length; j++) {
  const a = labels[i], b = labels[j];
  const wa = a.t.length*6.2/2, wb = b.t.length*6.2/2;
  if (Math.abs(a.x-b.x) < wa+wb && Math.abs(a.y-b.y) < 11) overlap++;
}
console.log('наложений подписей:', overlap, overlap === 0 ? '✅' : '⚠');
const outside = labels.filter(l => l.x < 0 || l.x > 360);
console.log('подписей за краем:', outside.length, outside.length === 0 ? '✅' : '⚠');
process.exit(0);
