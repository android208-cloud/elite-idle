/**
 * Проверяет, что характеристики планет печатаются НА мини-карте (§70).
 *
 * Раньше техуровень был чипом в кнопках списка под картой; теперь он
 * часть подписи у точки системы: «DISO / агро средняя · Т8». Список
 * под картой остался только для точного выбора цели (QUATOR и RA
 * стоят в 19 px друг от друга), и характеристик в нём быть не должно —
 * иначе они дублируются в двух местах и расходятся.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildGalaxy } from '../src/core/galaxy.ts';

const systems = buildGalaxy(1);
const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///d/t.html', virtualConsole: vc });
const { window } = dom;

/** Что нарисовано на холсте: fillText перехватываем. */
const drawn = [];
window.HTMLCanvasElement.prototype.getContext = () => ({
  setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
  arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){},
  fillText(t){ drawn.push(String(t)); },
  measureText: (t) => ({ width: t.length * 6 }),
  set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
});
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 700));
[...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'map')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));

const texts = drawn.join(' | ');
// Ожидание: у каждой видимой системы в окрестностях LAVE есть подпись
// с техуровнем. Ищем по имени системы и проверяем, что рядом стоит Тn.
const near = systems.filter((s) => {
  const here = systems.find((x) => x.name === 'LAVE');
  const radius = Math.max(3, (70 / 4) * 1.15);
  return Math.abs(s.x - here.x) <= radius && Math.abs(s.y / 2 - here.y / 2) <= radius;
});

let ok = 0;
const fails = [];
for (const s of near) {
  const tech = s.techLevel + 1;
  // Подпись может быть двухстрочной (имя отдельно, характеристики
  // отдельно) или однострочной «ИМЯ Тn».
  const twoLine = texts.includes(s.name) && texts.includes(`· Т${tech}`) || texts.includes(`Т${tech}`);
  const oneLine = texts.includes(`${s.name} Т${tech}`);
  const good = oneLine || (texts.includes(s.name) && texts.includes(`Т${tech}`));
  if (good) ok++;
  else fails.push(`${s.name} (ожидалось Т${tech})`);
  console.log(`${s.name.padEnd(10)} Т${tech}  ${good ? '✅' : '❌'}`);
}

const listButtons = [...window.document.querySelectorAll('[data-action="select-system"]')];
const techInList = listButtons.filter((b) => /Т\d+/.test(b.textContent)).length;

console.log(`\nтехуровень на карте: ${ok}/${near.length}`);
console.log(`техуровень в списке под картой: ${techInList} (должно быть 0)`);
if (fails.length) console.log('не найдено: ' + fails.join(', '));
process.exit(ok === near.length && techInList === 0 ? 0 : 1);
