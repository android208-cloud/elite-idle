/**
 * §103.1: в ангаре видно только то, что здесь продаётся.
 *
 * Раньше недоступный по техуровню предмет висел строкой «нет на этой
 * станции». На станции с техуровнем 1 таких строк было девять из
 * двенадцати — тот же мёртвый список, что §103 убрал на рынке.
 *
 * Исключение: оборудование, которое УЖЕ стоит на корабле, показывается
 * даже если здесь его не продают — «установлено» это состояние, а не
 * предложение.
 *
 * Проверяем на трёх станциях: LAVE (Т5), TEAATIS (Т3) и ONRIRA (Т14).
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

function save(system, ship) {
  const state = {
    version: 3, galaxy: 1, system, cash: 100000, fuel: 60, holdSpace: 20,
    cargo: Array(17).fill(0), market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'cobra3', laser: 'pulse', missiles: 3, ecm: false, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false, ...ship,
    },
    kills: 5, legal: 0, encounter: null, combat: null, salvage: null,
    stats: { kills: 5, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [], settings: {} };
}

function boot(system, ship) {
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
      w.localStorage.setItem('elite-idle-save-v1', JSON.stringify(save(system, ship)));
    },
  });
  return dom.window;
}

const tabBtn = (w, id) => [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === id);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const content = (w) => w.document.getElementById('content').textContent;

async function openHangar(system, ship) {
  const w = boot(system, ship);
  await new Promise((r) => setTimeout(r, 900));
  click(w, tabBtn(w, 'hangar'));
  await new Promise((r) => setTimeout(r, 250));
  return w;
}

/* ---------- Новая игра: голый Аддер из Elite-A (§102.3) ---------- */
{
  const fresh = new JSDOM(html, {
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
    },
  });
  const fw = fresh.window;
  await new Promise((r) => setTimeout(r, 900));
  const start = content(fw);
  check('новая игра: корабль — Аддер', /Adder/.test(start) && !/Cobra/.test(start));
  check('новая игра: ракеты показаны как «0 из 1»', /Ракеты: 0 из 1/.test(start));
  check('новая игра: трюм 8 т', /0 \/ 8/.test(start), start.match(/0 \/ \d+/)?.[0] ?? 'нет');
  check('новая игра: топливо 6.0', /Топливо6\.0 св\. г\./.test(start.replace(/\s+/g, ' ')));
  check('новая игра: денег 500 CR', /500\.0 CR/.test(start.replace(/\s+/g, ' ')),
    start.replace(/\s+/g, ' ').match(/\d+\.\d CR/)?.[0] ?? 'нет');
  check('новая игра: лазера нет', /Лазер: нет/.test(start));
  check('новая игра: патруль закрыт — ракет нет', /Не полный боекомплект: 0 из 1/.test(start));
  click(fw, tabBtn(fw, 'hangar'));
  await new Promise((r) => setTimeout(r, 250));
  const fh = content(fw);
  check('в ангаре Аддер', /Adder · ваш корабль в ангаре/.test(fh));
  check('в ангаре бак 6.0 из 6.0', /6\.0 св\. г\. из 6\.0/.test(fh.replace(/\s+/g, ' ')));
  check('большого трюма для Аддера нет', !/Увеличенный трюм/.test(fh));
  check('лазер купить можно — это первое дело', /Импульсный лазер/.test(fh));
  fw.close();
}

/* ---------- LAVE, техуровень 5: доступны предметы №2..№8 ---------- */
const lave = await openHangar(7, {});
const laveText = content(lave);
check('ангар открылся', lave.document.getElementById('title').textContent === 'Ангар',
  lave.document.getElementById('title').textContent);
check('модель корабля названа по данным', /Cobra Mk III · ваш корабль в ангаре/.test(laveText));
check('нет строк «нет на этой станции»', !/нет на этой станции/.test(laveText));
check('продаётся то, что по техуровню доступно', /Топливосборщик/.test(laveText) && /ECM/.test(laveText));
check('военного лазера здесь нет', !/Военный лазер/.test(laveText));
check('энергобомбы здесь нет', !/Энергобомба/.test(laveText));
check('галактического двигателя здесь нет', !/Галактический гипердвигатель/.test(laveText));
check('строка про техуровень объясняет фильтр', /показано только то, что на этой станции продаётся/.test(laveText));
/* Ракеты: предел — свойство корабля, значит в подписи «из 4». */
check('у ракет предел корабля', /сейчас 3 из 4/.test(laveText), laveText.match(/сейчас \d+ из \d+/)?.[0] ?? 'нет');
lave.close();

/* ---------- TEAATIS, техуровень 3: №2..№6, но ГГД уже стоит ---------- */
const teaatis = await openHangar(10, { galacticHyperdrive: true, laser: 'military' });
const tText = content(teaatis);
check('установленный предмет виден, даже если здесь не продаётся',
  /Галактический гипердвигатель/.test(tText));
check('и подписан как установленный', /установлено/.test(tText));
check('установленный лазер тоже виден', /Военный лазер/.test(tText));
// TEAATIS: техуровень 2 (в игре показывается 3), значит QQ25 = 5 —
// продаются только предметы №2..№5, и лучевого лазера (№6) здесь нет.
check('лучевой лазер (№6) здесь не продаётся', !/Лучевой лазер/.test(tText));
check('импульсный лазер (№5) продаётся', /Импульсный лазер/.test(tText));
check('стыковочного компьютера (№11) здесь нет', !/Стыковочный компьютер/.test(tText));
check('в списке остались только покупные и установленные строки',
  [...teaatis.document.querySelectorAll('.good-row')].length === 6,
  `строк: ${[...teaatis.document.querySelectorAll('.good-row')].length}`);
teaatis.close();

/* ---------- ONRIRA, техуровень 14: продаётся всё ---------- */
const onrira = await openHangar(23, {});
const oText = content(onrira);
check('на высокой станции есть военный лазер', /Военный лазер/.test(oText));
check('на высокой станции есть галактический двигатель', /Галактический гипердвигатель/.test(oText));
check('все двенадцать строк на месте',
  [...onrira.document.querySelectorAll('.good-row')].length === 12,
  `строк: ${[...onrira.document.querySelectorAll('.good-row')].length}`);
check('скрытых подписей не осталось', !/нет на этой станции/.test(oText));
onrira.close();

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
