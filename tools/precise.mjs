/**
 * Проверяет точность: кликаем ровно в экранную позицию системы
 * и смотрим, какая выбралась.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildGalaxy } from '../src/core/galaxy.ts';

const systems = buildGalaxy(1);
const lave = systems.find((s) => s.name === 'LAVE');
const width = 360, pad = 10, fuel = 70;
const radius = Math.max(3, (fuel / 4) * 1.15);
const k = Math.min((width - 2 * pad) / (2 * radius), (width - 2 * pad) / (2 * radius));
const at = (gx, gy) => ({ x: width / 2 + (gx - lave.x) * k, y: width / 2 + (gy / 2 - lave.y / 2) * k });

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
const mapTab = [...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'map');
mapTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 250));

const visible = systems.filter((s) => Math.abs(s.x - lave.x) <= radius && Math.abs(s.y / 2 - lave.y / 2) <= radius);
console.log('система старта: LAVE индекс', lave.index, '| топливо', fuel);
console.log('ожидаем увидеть:', visible.map(s=>s.name).join(', '));

// Что игра реально показывает в списке кнопок?
// Диагностика: что игра считает «текущей системой»?
const infoCards = [...window.document.querySelectorAll('.card')];
console.log('карточек на экране:', infoCards.length);
const heads = [...window.document.querySelectorAll('.map-card h2')].map(h=>h.textContent);
console.log('заголовки карт:', heads.join(' | '));
const buttons = [...window.document.querySelectorAll('[data-action="select-system"]')];
console.log('кнопок в списке:', buttons.length);
console.log('игра показывает:', buttons.map(b=>b.textContent.trim().split(' ')[0]).join(', '));

let ok = 0;
for (const s of visible) {
  const p = at(s.x, s.y);
  const local = window.document.getElementById('map-local');
  console.log(`  клик в (${p.x.toFixed(0)},${p.y.toFixed(0)}) по ${s.name}`);
  local.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: p.x, clientY: p.y }));
  await new Promise((r) => setTimeout(r, 60));
  const cards = [...window.document.querySelectorAll('.card')];
  const text = cards[cards.length - 1].textContent.replace(/\s+/g, ' ').trim();
  const got = systems.find((x) => text.startsWith(x.name))?.name ?? '—';
  const good = got === s.name;
  if (good) ok++;
  console.log(`${s.name.padEnd(10)} → ${got.padEnd(10)} ${good ? '✅' : '❌'}`);
}
console.log(`\nитог: ${ok}/${visible.length}`);
process.exit(0);
