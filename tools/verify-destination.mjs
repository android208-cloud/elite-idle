/**
 * Блок «Пункт назначения» на экране «Корабль» (§71).
 *
 * Пользователь просил имя планеты, расстояние и время полёта. Все три
 * должны совпадать с тем, что игра реально сделает при прыжке, поэтому
 * время сверяется с jumpDuration, а расстояние — с distance.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildGalaxy, distance } from '../src/core/galaxy.ts';
import { DEFAULT_SETTINGS, jumpDuration } from '../src/core/state.ts';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/', virtualConsole: vc });
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = () => ({
  setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
  arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
  measureText: (t) => ({ width: String(t).length * 6 }),
  set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
});
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 800));
const clickTab = (id) => [...window.document.querySelectorAll('[data-action="tab"]')].find(t => t.dataset.tab === id)
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

// 1. Пока цель не выбрана
const page0 = window.document.getElementById('content').innerHTML;
check('на экране есть блок «Пункт назначения»', page0.includes('Пункт назначения'));
check('без цели — подсказка', page0.includes('Не выбран'), '');

// 2. Выбираем систему на карте
clickTab('map');
await new Promise((r) => setTimeout(r, 300));
const labels = [];
window.HTMLCanvasElement.prototype.getContext = () => ({
  setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
  arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(t, x, y){ labels.push({ t: String(t), x, y }); },
  measureText: (t) => ({ width: String(t).length * 6 }),
  set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
});
clickTab('ship');
await new Promise((r) => setTimeout(r, 100));
clickTab('map');
await new Promise((r) => setTimeout(r, 250));

const systems = buildGalaxy(1);
const target = labels.map((l) => systems.find((s) => s.name === l.t || l.t === `${s.name} Т${s.techLevel + 1}`))
  .find((s) => s && s.name !== 'LAVE');
if (!target) { console.log('❌ не нашёл подписи на карте'); process.exit(1); }
const lab = labels.find((l) => l.t === target.name || l.t.startsWith(target.name + ' '));
window.document.getElementById('map-local').dispatchEvent(
  new window.MouseEvent('pointerdown', { bubbles: true, clientX: lab.x, clientY: lab.y }),
);
await new Promise((r) => setTimeout(r, 250));

// 3. Смотрим экран «Корабль»
clickTab('ship');
await new Promise((r) => setTimeout(r, 250));
const page = window.document.getElementById('content').innerHTML;
const text = window.document.getElementById('content').textContent;
const here = systems.find((s) => s.name === 'LAVE');
const d = distance(here, target);
const trip = jumpDuration(DEFAULT_SETTINGS, d);

check('в блоке имя планеты', page.includes(target.name), target.name);
check('в блоке расстояние', text.includes(`${(d / 10).toFixed(1)} св. г.`), `${(d / 10).toFixed(1)} св. г.`);
// Ожидание — в том же формате, что печатает fmtDur.
const total = Math.ceil(trip / 1000);
const hh = Math.floor(total / 3600);
const mi = Math.floor((total % 3600) / 60);
const se = total % 60;
const pad = (n) => String(n).padStart(2, '0');
const expect = hh > 0 ? (mi > 0 ? `${hh} ч ${pad(mi)} мин` : `${hh} ч`) : mi > 0 ? (se > 0 ? `${mi} мин ${pad(se)} с` : `${mi} мин`) : `${se} с`;
check('в блоке время полёта', text.includes(expect), `${expect} (${Math.round(trip / 60000)} мин)`);

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
