/** Проверяет техуровень в списке систем. */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildGalaxy } from '../src/core/galaxy.ts';

const systems = buildGalaxy(1);
const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();
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
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 700));
[...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'map')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 250));

const buttons = [...window.document.querySelectorAll('[data-action="select-system"]')];
console.log('кнопок:', buttons.length);
let ok = 0;
for (const b of buttons) {
  const name = b.textContent.trim().split(' ')[0];
  const techEl = b.querySelector('.tech');
  const shown = techEl?.textContent ?? '—';
  const s = systems.find((x) => x.name === name);
  const expected = s ? `Т${s.techLevel + 1}` : '?';
  const good = shown === expected;
  if (good) ok++;
  console.log(`${name.padEnd(10)} показ ${shown.padEnd(4)} ожидание ${expected.padEnd(4)} ${good ? '✅' : '❌'}`);
}
console.log(`\nитог: ${ok}/${buttons.length}`);
process.exit(0);
