/** Проверяет, что модель корабля рисуется на главном экране. */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const errors = [];
const paths = [];
const vc = new VirtualConsole().on('jsdomError', (e) => errors.push(String(e)));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///d/g.html', virtualConsole: vc });
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = function () {
  let last = null;
  return {
    setTransform() {}, clearRect() {}, beginPath() {}, closePath() {},
    moveTo(x, y) { last = [x, y]; },
    lineTo(x, y) { if (last) paths.push([...last, x, y]); last = [x, y]; },
    stroke() {}, fill() {}, arc() {}, save() {}, restore() {},
    set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {}, set lineJoin(v) {}, set font(v) {},
  };
};
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 900));

const canvas = window.document.getElementById('ship-model');
console.log('=== модель корабля ===');
console.log('canvas на экране «Корабль»:', canvas ? 'да ✅' : 'НЕТ ❌');
console.log('подпись:', window.document.querySelector('.ship-view .sub')?.textContent ?? '—');
console.log('ошибки:', errors.length ? errors.slice(0, 2).join(' | ') : 'нет ✅');
console.log('линий нарисовано:', paths.length, paths.length >= 38 ? '(все 38 рёбер) ✅' : '\u26a0');
const xs = paths.flatMap((p) => [p[0], p[2]]);
const ys = paths.flatMap((p) => [p[1], p[3]]);
console.log('габариты рисунка: X', Math.min(...xs).toFixed(0), '..', Math.max(...xs).toFixed(0),
  '| Y', Math.min(...ys).toFixed(0), '..', Math.max(...ys).toFixed(0));
console.log('в пределах 360×166:', Math.min(...xs) >= 0 && Math.max(...xs) <= 360 && Math.min(...ys) >= 0 && Math.max(...ys) <= 166 ? 'да ✅' : 'выходит ❌');
process.exit(0);
