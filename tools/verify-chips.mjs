/**
 * §116: ПИЛЮЛИ «дорого» / «дёшево» — ПОДПИСЬ И РАЗМЕТКА.
 *
 * Пользователь на скриншоте рынка: «выровнять пилюли с надписями». Пилюля
 * стояла в тексте строки, поэтому её положение задавала базовая линия, а
 * зазор зависел от случайного пробела в разметке.
 *
 * Теперь строка названия — флекс (`display: flex; align-items: center;
 * gap: 8px`), и пилюля центрируется по названию при любой его длине.
 * Проверяется две вещи: разметка (у таких строк есть класс `with-chip`) и
 * само правило в собранном файле — иначе класс окажется пустым обещанием.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const LAVE = 7;

function save() {
  const state = {
    version: 4, galaxy: 1, system: LAVE, cash: 200000, fuel: 60, holdSpace: 8,
    // Цены нарочно разъезжаются с базой: пилюля показывается при ±8 %,
    // и на ровных числах проверять было бы нечего.
    cargo: Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }).map((m, i) => ({
      // 76 = 4 × базовая цена еды => ровно «нормальная» цена, без пилюли;
      // остальные позиции уводят цену за ±8 % и получают метку.
      price: i === 0 ? 76 : i % 2 === 0 ? 400 : 10,
      quantity: 5,
    })),
    rng: 1, flight: null,
    ship: {
      model: 'adder', laser: 'pulse', missiles: 1, ecm: true, energyBomb: true,
      energyUnit: false, fuelScoops: true, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false,
    },
    kills: 0, legal: 0, encounter: null, combat: null, salvage: null,
    pilots: [], nextPilotId: 1,
    stats: { kills: 0, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [], settings: {} };
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/',
  virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => ({
      setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
      arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
      measureText: (t) => ({ width: String(t).length * 6 }),
      set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
    });
    w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    w.cancelAnimationFrame = clearTimeout;
    w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(save()));
  },
});
const w = dom.window;
await new Promise((r) => setTimeout(r, 900));

const tabBtn = (id) => [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === id);
tabBtn('market').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));

/* ---------- Разметка ---------- */
const chips = [...w.document.querySelectorAll('.name .chip')];
check('на рынке есть пилюли цены', chips.length > 0, `${chips.length} шт.`);
check('пилюли стоят в строке названия, а не отдельной строкой',
  chips.every((c) => c.parentElement.classList.contains('name')));
check('у всех таких названий класс with-chip',
  chips.every((c) => c.parentElement.classList.contains('with-chip')));
const plain = [...w.document.querySelectorAll('.name')].filter((n) => !n.querySelector('.chip'));
check('строка без пилюли остаётся простой строкой',
  plain.length > 0 && plain.every((n) => !n.classList.contains('with-chip')), `${plain.length} шт.`);
check('зазор даёт правило, а не пробел в разметке',
  chips.every((c) => !/\s$/.test(c.previousSibling?.nodeValue ?? '')));

/* ---------- Правило в собранном файле ---------- */
// Сборка минифицирует CSS: пробелы после двоеточия не гарантированы.
const rule = html.match(/\.name\.with-chip\s*\{([^}]*)\}/)?.[1] ?? '';
check('в сборке есть правило with-chip', rule !== '');
check('строка названия — флекс', /display:\s*flex/.test(rule), rule.trim());
check('пилюля выровнена по центру строки', /align-items:\s*center/.test(rule));
check('зазор задан правилом, а не пробелом', /gap:\s*8px/.test(rule));

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
