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

/*
 * §102.3: стартовый корабль стал Аддером с баком 6.0 ly, и радиус карты у
 * него меньше — часть подписей из проверки пропала бы просто потому, что
 * эти системы дальше шести световых лет. Проверка здесь про подписи, а не
 * про стартовый бак, поэтому берём Кобру с её 7.0 ly.
 */
function save() {
  const state = {
    version: 3, galaxy: 1, system: 7, cash: 1000, fuel: 70, holdSpace: 20,
    cargo: Array(17).fill(0), market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: { model: 'cobra3', laser: 'pulse', missiles: 3, ecm: false, energyBomb: false,
            energyUnit: false, fuelScoops: false, dockingComputer: false,
            galacticHyperdrive: false, cargoBayExtended: false },
    kills: 5, legal: 0, encounter: null, combat: null, salvage: null,
    stats: { kills: 5, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [], settings: {} };
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/', virtualConsole: vc,
  beforeParse(w) {
    w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(save()));
  },
});
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
