/**
 * §117: СКОРОСТЬ ПРЫЖКА И СТАРОЕ УМОЛЧАНИЕ В СОХРАНЕНИИ.
 *
 * Нашлось по отладочному файлу игрока: `settings.baseJumpMs = 900000`
 * (15 минут) при текущем умолчании 2 000 000, и прыжок 2.6 св. г. в журнале
 * занял 2.5 с вместо 5.5. Поля этого нет ни в настройках, ни на экране
 * отладки — то есть игрок не мог его поменять: просто сохранение несло
 * прежнее умолчание, а `{ ...DEFAULT_SETTINGS, ...saved }` его уважал.
 *
 * Здесь проверяется обе половины правки:
 *   1. старое значение из сохранения заменяется текущим (иначе прыжки
 *      остаются вдвое быстрее задуманного);
 *   2. подпись в настройках считает время для НАСТОЯЩИХ 7 и 3 св. лет, а
 *      не для 0.7 и 0.3 — раньше она занижала в десять раз.
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
/** Прежнее умолчание темпа: 15 минут на полный бак (§76). */
const LEGACY_BASE_JUMP_MS = 15 * 60 * 1000;
const CURRENT_BASE_JUMP_MS = 2000 * 1000;

function save(settings) {
  const state = {
    version: 4, galaxy: 1, system: LAVE, cash: 5000, fuel: 60, holdSpace: 8,
    cargo: Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'adder', laser: 'pulse', missiles: 1, ecm: false, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false,
    },
    kills: 0, legal: 0, encounter: null, combat: null, salvage: null,
    pilots: [], nextPilotId: 1,
    stats: { kills: 0, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [], settings };
}

function boot(saved) {
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
      w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(saved));
    },
  });
  return dom.window;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tabBtn = (w, id) => [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === id);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const content = (w) => w.document.getElementById('content').textContent.replace(/\s+/g, ' ');

/** Открывает «Журнал» — карточка настроек живёт там. */
async function settingsScreen(settings) {
  const w = boot(save(settings));
  await wait(900);
  click(w, tabBtn(w, 'log'));
  await wait(300);
  return w;
}

/* ---------- Старое умолчание перекрыто текущим ---------- */
{
  // Скорость ×200: полный бак (7.0 св. г.) — ровно 10 секунд при текущем
  // умолчании и 5 секунд при старом. Число на экране и есть доказательство.
  const w = await settingsScreen({ speed: 200, baseJumpMs: LEGACY_BASE_JUMP_MS });
  const text = content(w);
  check('старый baseJumpMs из сохранения не применяется', /Прыжок 7 св\. лет: 10 с/.test(text),
    text.match(/Прыжок 7 св\. лет: [^·]+/)?.[0]?.trim() ?? '');
  // 3 св. г. = 30 десятых → 2 000 000 × (30/70)^0.6 / 200 ≈ 6.02 с, а
  // fmtDur округляет вверх — на экране «7 с».
  check('и 3 св. года считаются по-новому', /3 св\. года: 7 с/.test(text),
    text.match(/3 св\. года: [^\s]+ ?[^\s]*/)?.[0]?.trim() ?? '');
  w.close();
}

/* ---------- Явно заданный текущий темп не портится ---------- */
{
  const w = await settingsScreen({ speed: 200, baseJumpMs: CURRENT_BASE_JUMP_MS });
  check('текущее значение остаётся', /Прыжок 7 св\. лет: 10 с/.test(content(w)));
  w.close();
}

/* ---------- Темп влияет и на подпись ---------- */
{
  const w = await settingsScreen({ speed: 1, baseJumpMs: CURRENT_BASE_JUMP_MS });
  check('на ×1 полный бак — 33 минуты', /Прыжок 7 св\. лет: 33 мин/.test(content(w)),
    content(w).match(/Прыжок 7 св\. лет: [^·]+/)?.[0]?.trim() ?? '');
  w.close();
}

/* ---------- Подпись не врёт в 10 раз ---------- */
{
  const w = await settingsScreen({ speed: 200, baseJumpMs: CURRENT_BASE_JUMP_MS });
  const text = content(w);
  // 7 св. лет — это 70 десятых, а 3 св. года — 30. Если в код снова
  // попадёт 7 и 3, подпись покажет 3 с и 1 с — как было до правки.
  check('7 св. лет — не 0.7 св. г.', !/Прыжок 7 св\. лет: [0-4] с/.test(text));
  check('3 св. года — не 0.3 св. г.', !/3 св\. года: [01] с/.test(text));
  w.close();
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
