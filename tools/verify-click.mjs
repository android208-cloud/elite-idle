/** Проверяет, что малая карта кликабельна и список систем работает. */
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
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 700));
const mapTab = [...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'map');
mapTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 250));

console.log('=== малая карта ===');
const local = window.document.getElementById('map-local');
console.log('холст есть:', local ? 'да ✅' : 'НЕТ ❌');
console.log('обработчик data-local:', local?.dataset.local === '1' ? 'да ✅' : 'НЕТ ❌');

const buttons = [...window.document.querySelectorAll('[data-action="select-system"]')];
console.log('=== список систем ===');
console.log('кнопок:', buttons.length);
console.log('примеры:', buttons.slice(0, 6).map((b) => b.textContent.trim().split(' ')[0]).join(', '));
const disabled = buttons.filter((b) => b.disabled).length;
console.log('недоступных (нет топлива):', disabled);

// Клик по первой доступной кнопке
const target = buttons.find((b) => !b.disabled);
if (target) {
  const name = target.textContent.trim().split(' ')[0];
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const cards = [...window.document.querySelectorAll('.card')];
  const info = cards[cards.length - 1].textContent.replace(/\s+/g, ' ').trim();
  console.log(`клик по «${name}» → выбрано:`, info.slice(0, 40));
  console.log('совпало:', info.startsWith(name) || info.includes(name) ? 'да ✅' : 'НЕТ ❌');
}
console.log('ошибки:', errors.length ? errors[0].slice(0, 100) : 'нет ✅');
process.exit(0);
