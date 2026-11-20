/**
 * §122: НАПАДАТЬ ВРУЧНУЮ МОЖНО И В РОЗЫСКЕ.
 *
 * Пользователь: «в розыске при перелёте я не могу атаковать корабли
 * вручную». Причина была в `isWeak`: он возвращал false для любой модели
 * без флага `pirate`, то есть для полицейского Viper'а и торговой Cobra —
 * даже когда те сами атакуют, а игрок уже преступник. Кнопка «Напасть»
 * была выключена с причиной «Корабль слишком силён».
 *
 * Проверяется:
 *   1. чистому игроку на мирного торговца напасть нельзя — и сказано, что
 *      это было бы преступлением;
 *   2. в розыске на полицейского Viper'а «Напасть» доступна;
 *   3. победа над полицейским вручную поднимает розыск на 64 (как в автобое);
 *   4. в розыске на торговца «Напасть» доступна;
 *   5. победа над торговцем вручную даёт груз в трюм и +32 к розыску.
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
const SAVE_KEY = 'elite-idle-save-v1';

/** Встреча посреди перелёта: полёт не даёт прибыть, пока идёт разбор. */
function save({ legal = 0, role = 'police', enemyId = 'viper', hostile = true, cargo, laser = 'pulse', model = 'cobra3' }) {
  const now = Date.now();
  const state = {
    version: 4, galaxy: 1, system: LAVE, cash: 50_000, fuel: 60, holdSpace: 12,
    cargo: cargo ?? Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 7, flight: {
      from: LAVE, to: (LAVE + 1) % 256,
      departAt: now, arriveAt: now + 9e9,
      remainingBaseMs: 9e9, elapsedBaseMs: 0, dueAt: now, pending: [],
    },
    ship: {
      model, laser, missiles: 2, ecm: false, energyBomb: false,
      energyUnit: false, fuelScoops: false, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false,
    },
    kills: 200, legal,
    encounter: {
      role, enemyId,
      detectedAt: now,
      resolveAt: now + 9e9,
      outcome: hostile ? 'attack' : 'leave',
    },
    combat: null, salvage: null,
    pilots: [], nextPilotId: 1,
    stats: { kills: 200, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0, raided: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [], settings: { speed: 1, encounterRate: 0 } };
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
      w.localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
    },
  });
  return dom.window;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const content = (w) => w.document.getElementById('content').textContent.replace(/\s+/g, ' ');
const attackBtn = (w) => w.document.querySelector('[data-action="decide"][data-decision="attack"]');
const saved = (w) => JSON.parse(JSON.parse(w.localStorage.getItem(SAVE_KEY)).state);
const log = (w) => JSON.parse(w.localStorage.getItem(SAVE_KEY)).log ?? [];
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

/* ---------- 1. Чистому на мирного торговца — нельзя ---------- */
{
  const w = boot(save({ legal: 0, role: 'trader', enemyId: 'cobra3', hostile: false }));
  await wait(900);
  const btn = attackBtn(w);
  check('кнопка «Напасть» на месте', !!btn);
  check('чистому она недоступна', btn?.disabled === true);
  check('и причина названа: это было бы преступлением',
    /атака была бы преступлением/.test(content(w)));
  w.close();
}

/* ---------- 2. В розыске на полицейского — можно ---------- */
{
  const w = boot(save({ legal: 128, role: 'police', enemyId: 'viper', hostile: true }));
  await wait(900);
  const btn = attackBtn(w);
  check('§122: в розыске «Напасть» на полицию доступна', btn !== null && btn.disabled === false,
    content(w).match(/Корабль[^.]*/)?.[0] ?? '');
  check('§122: и нет отговорки «слишком силён»', !/слишком силён/.test(content(w)));
  w.close();
}

/* ---------- 3. Победа над полицейским вручную стоит 64 ---------- */
{
  const w = boot(save({ legal: 128, role: 'police', enemyId: 'viper', hostile: true }));
  await wait(900);
  click(w, attackBtn(w));
  await wait(400);
  const s = saved(w);
  check('§122: розыск вырос на 64', s.legal === 192, `legal ${s.legal}`);
  check('§122: в журнале цена названа',
    log(w).some((l) => /Полицейский уничтожен: розыск \+64 → 192/.test(l.text)),
    log(w).find((l) => /Полицейский уничтожен/.test(l.text))?.text ?? '');
  check('§122: убийство засчитано', s.kills === 201, `kills ${s.kills}`);
  w.close();
}

/* ---------- 4. В розыске на торговца — можно ---------- */
{
  const w = boot(save({ legal: 60, role: 'trader', enemyId: 'cobra3', hostile: true }));
  await wait(900);
  const btn = attackBtn(w);
  check('§122: в розыске «Напасть» на торговца доступна', btn !== null && btn.disabled === false);
  w.close();
}

/* ---------- 5. Грабёж вручную: груз и +32 ---------- */
{
  const w = boot(save({ legal: 60, role: 'trader', enemyId: 'cobra3', hostile: true }));
  await wait(900);
  const cargo0 = saved(w).cargo.reduce((a, b) => a + b, 0);
  click(w, attackBtn(w));
  await wait(400);
  const s = saved(w);
  const cargo1 = s.cargo.reduce((a, b) => a + b, 0);
  check('§122: трюм пополнился', cargo1 > cargo0, `было ${cargo0} т, стало ${cargo1} т`);
  check('§122: розыск вырос на 32', s.legal === 92, `legal ${s.legal}`);
  check('§122: в журнале сказано про ограбление',
    log(w).some((l) => /Ограблен торговец/.test(l.text)),
    log(w).find((l) => /Ограблен торговец/.test(l.text))?.text.slice(0, 60) ?? '');
  check('§122: ограбление попало в статистику', s.stats.raided === 1, `raided ${s.stats.raided}`);
  w.close();
}

/* ---------- 6. §123: без лазера причина названа честно ---------- */
{
  /*
   * Пользователь купил Анаконду, оборудование слетело (это сказано в
   * подтверждении покупки), и кнопка «Напасть» навсегда писала «Корабль
   * слишком силён». Настоящая причина — нечем стрелять.
   */
  const w = boot(save({ legal: 233, role: 'police', enemyId: 'viper', hostile: true, laser: 'none', model: 'anaconda' }));
  await wait(900);
  const btn = attackBtn(w);
  check('§123: без лазера «Напасть» недоступна', btn !== null && btn.disabled === true);
  check('§123: и причина названа прямо', /Нет лазера: стрелять нечем/.test(content(w)),
    content(w).match(/Нет лазера[^.]*/)?.[0] ?? '');
  check('§123: и не враньё про «слишком силён»', !/слишком силён/.test(content(w)));
  w.close();
}

/* ---------- 7. §123: предупреждение на экране «Корабль» ---------- */
{
  const w = boot(save({ legal: 233, role: 'police', enemyId: 'viper', hostile: true, laser: 'none', model: 'anaconda' }));
  await wait(900);
  const tab = [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === 'ship');
  tab?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(300);
  const text = content(w);
  check('§123: на экране «Корабль» карточка «Лазера нет»', /Лазера нет/.test(text));
  check('§123: сказано, что делать', /Купите лазер в ангаре/.test(text));
  w.close();
}

/* ---------- 8. §123: с лазером предупреждения нет ---------- */
{
  const w = boot(save({ legal: 233, role: 'police', enemyId: 'viper', hostile: true }));
  await wait(900);
  const tab = [...w.document.querySelectorAll('[data-action="tab"]')].find((b) => b.dataset.tab === 'ship');
  tab?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(300);
  check('§123: с лазером карточки нет', !/Лазера нет/.test(content(w)));
  w.close();
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
