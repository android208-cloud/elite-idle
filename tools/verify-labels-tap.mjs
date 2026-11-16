/**
 * Касание по подписи на карте выбирает ту систему, что подписана.
 *
 * Зачем проверка: список систем под картой убран, а он решал проблему
 * точности — QUATOR и RA стоят в 19 px, палец их не разделит. Теперь
 * подпись работает как кнопка. Если порядок проверок в onMapTap
 * сломать (сначала «ближайшая точка»), тап по названию соседа начнёт
 * выбирать не ту систему — и это тихий баг, который глазами не виден.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildGalaxy, distance } from '../src/core/galaxy.ts';

const systems = buildGalaxy(1);
const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///d/lt.html', virtualConsole: vc });
const { window } = dom;

// Холст: запоминаем, в каких координатах нарисована каждая подпись.
const labels = [];
let currentTexts = [];
window.HTMLCanvasElement.prototype.getContext = () => ({
  setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
  arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){},
  fillText(t, x, y){ labels.push({ text: String(t), x, y }); },
  measureText: (t) => ({ width: String(t).length * 6 }),
  set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
});
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
  value() { return { left: 0, top: 0, width: 360, height: 360, right: 360, bottom: 360, x: 0, y: 0 }; },
  configurable: true,
});
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 700));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
click([...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'map'));
await new Promise((r) => setTimeout(r, 300));

const canvas = window.document.getElementById('map-local');
if (!canvas) { console.log('❌ нет местной карты'); process.exit(1); }

// Список под картой должен исчезнуть.
const list = window.document.querySelector('.system-list');
const listButtons = window.document.querySelectorAll('[data-action="select-system"]');
console.log(`${list ? '❌' : '✅'} перечня планет под картой нет${listButtons.length ? ` (кнопок ${listButtons.length})` : ''}`);

// Берём подпись системы, которая в окрестностях есть и не является текущей.
const names = [...new Set(labels.map((l) => l.text))];
const near = systems.filter((s) => names.includes(s.name));
const target = near.find((s) => s.name !== 'LAVE') ?? near[0];
if (!target) { console.log('❌ подписей не найдено'); process.exit(1); }

// Тапаем в центр подписи.
//
// ВАЖНО: игра слушает pointerdown, а не click. Она перешла на него
// специально — при прокрутке click не приходит вовсе, и «нажать на
// мини-карту» не получалось. Тест обязан слать то же событие, иначе
// проверяет не то, что происходит на телефоне.
const lab = labels.find((l) => l.text === target.name);
canvas.dispatchEvent(new window.MouseEvent('pointerdown', {
  bubbles: true, clientX: lab.x, clientY: lab.y,
}));
await new Promise((r) => setTimeout(r, 250));

const html2 = window.document.getElementById('content').innerHTML;
const chosen = html2.includes(`<h2>${target.name}</h2>`);
console.log(`${chosen ? '✅' : '❌'} тап по подписи выбрал ${target.name}` + (chosen ? '' : ' — выбрана другая система'));
if (!chosen) {
  const m = html2.match(/<h2>([A-Z]+)<\/h2>/);
  if (m) console.log('   в карточке: ' + m[1]);
}
/*
 * Главное: системы, которые пальцем не разделить, различаются по
 * подписям. QUATOR и RA стоят в 19 px — это предел разрешения экрана.
 * Проверяем все пары подписей, что нарисованы на местной карте.
 */
let pairsOk = 0;
let pairsBad = [];

/** Позиции подписей НА ТЕКУЩЕМ экране — перед каждым тапом свежие. */
function readLabels() {
  labels.length = 0;
  drawAgain();
  const out = new Map();
  for (const l of labels) {
    const sys = systems.find((s) => l.text === s.name || l.text === `${s.name} Т${s.techLevel + 1}`);
    if (sys && !out.has(sys.name)) out.set(sys.name, l);
  }
  return [...out.entries()];
}

/** Перерисовать карту: вызываем обработчик изменения размера окна. */
function drawAgain() {
  window.dispatchEvent(new window.Event('resize'));
}

const named = readLabels();
for (let i = 0; i < named.length; i++) {
  for (let j = i + 1; j < named.length; j++) {
    const [n1, l1] = named[i];
    const [n2, l2] = named[j];
    const s1 = systems.find((s) => s.name === n1);
    const s2 = systems.find((s) => s.name === n2);
    if (distance(s1, s2) > 70) continue; // только тесно стоящие
    // Тап по подписи второй — должна выбраться именно она.
    // Позицию берём заново: после предыдущего выбора экран перерисован.
    const fresh = new Map(readLabels());
    const spot = fresh.get(n2) ?? l2;
    window.document.getElementById('map-local').dispatchEvent(
      new window.MouseEvent('pointerdown', { bubbles: true, clientX: spot.x, clientY: spot.y }),
    );
    await new Promise((r) => setTimeout(r, 120));
    const page = window.document.getElementById('content').innerHTML;
    if (page.includes(`<h2>${n2}</h2>`)) pairsOk++;
    else pairsBad.push(`${n1}/${n2}`);
  }
}
console.log(`${pairsBad.length ? '❌' : '✅'} тесные пары различаются по подписи: ${pairsOk}/${pairsOk + pairsBad.length}`);
if (pairsBad.length) console.log('   путаются: ' + pairsBad.join(', '));

process.exit(chosen && !list && !pairsBad.length ? 0 : 1);
