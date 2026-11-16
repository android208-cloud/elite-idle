/** Проверяет, что корабль рисуется залитыми гранями, а не каркасом. */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const errors = [];
const fills = [];
const strokes = [];
const vc = new VirtualConsole().on('jsdomError', (e) => errors.push(String(e)));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///d/g.html', virtualConsole: vc });
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = function () {
  let poly = [];
  let cur = null;
  return {
    setTransform(){}, clearRect(){}, beginPath(){ poly = []; cur = null; }, closePath(){},
    moveTo(x, y){ cur = [x, y]; poly.push([x, y]); },
    lineTo(x, y){ cur = [x, y]; poly.push([x, y]); },
    stroke(){ if (poly.length > 1) strokes.push([...poly]); },
    fill(){ if (poly.length > 2) fills.push({ n: poly.length, pts: [...poly] }); },
    arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
    measureText: (t) => ({ width: t.length * 6 }),
    set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){},
    set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
  };
};
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 900));

console.log('=== корабль ===');
console.log('ошибки:', errors.length ? errors[0].slice(0, 100) : 'нет ✅');
console.log('заливок (граней):', fills.length);
console.log('обводок (рёбер):', strokes.length);
const sizes = {};
for (const f of fills) sizes[f.n] = (sizes[f.n] || 0) + 1;
console.log('полигоны по числу вершин:', JSON.stringify(sizes));
console.log('это заливка, а не каркас:', fills.length > 0 ? 'да ✅' : 'НЕТ ❌');
process.exit(0);
