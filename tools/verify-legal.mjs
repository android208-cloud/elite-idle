/**
 * §118: РОЗЫСК В ПАТРУЛЕ И ДВЕ ВКЛАДКИ.
 *
 * Отладочный файл игрока показал «пиратство во время патруля»: статус был
 * выше нуля, полиция стала враждебной, автобой сбил семь Viper'ов по +64 и
 * упёрся в потолок 255. Решение пользователя — поведение НЕ менять, но
 * предупредить до нажатия и показать цену в журнале.
 *
 * Плюс вторая находка того же файла: два экземпляра игры делили одно
 * сохранение и затирали друг друга (108 474 CR в одном, 340 081 в другом
 * через час). Теперь вкладки договариваются, кто хозяин сейва.
 *
 * Проверяется:
 *   1. при чистом статусе кнопка «Патрулировать» и предупреждения нет;
 *   2. при розыске кнопка — «Пиратство» и есть строка с цифрой статуса;
 *   3. живая чужая вкладка даёт предупреждение и БЛОКИРУЕТ сохранение;
 *   4. «Играть здесь» забирает хозяина и снимает предупреждение;
 *   5. мёртвая (старая) метка чужой вкладки ничего не блокирует.
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
const TAB_KEY = 'elite-idle-tab-v1';
const SAVE_KEY = 'elite-idle-save-v1';

function save({ legal = 0 } = {}) {
  const state = {
    version: 4, galaxy: 1, system: LAVE, cash: 5000, fuel: 60, holdSpace: 8,
    cargo: Array(17).fill(0),
    market: Array(17).fill({ price: 100, quantity: 5 }),
    rng: 1, flight: null,
    ship: {
      model: 'python', laser: 'military', missiles: 4, ecm: true, energyBomb: true,
      energyUnit: true, fuelScoops: true, dockingComputer: false,
      galacticHyperdrive: false, cargoBayExtended: false,
    },
    kills: 200, legal, encounter: null, combat: null, salvage: null,
    pilots: [], nextPilotId: 1,
    stats: { kills: 200, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0, tradeProfit: 0 },
    cargoBasis: Array(17).fill(0), cargoOrigin: [],
    escapeRoute: [], escapeStatus: -1, careerMs: 0, careerAt: 0,
  };
  return { state: JSON.stringify(state), log: [], settings: { speed: 200 } };
}

/** Живая метка соседней вкладки: id чужой, время свежее. */
const foreignTab = (ageMs = 0) => JSON.stringify({ id: 'other-tab', at: Date.now() - ageMs });

function boot(saved, seed = {}) {
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
      for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
    },
  });
  return dom.window;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const content = (w) => w.document.getElementById('content').textContent.replace(/\s+/g, ' ');
const byAction = (w, a) => w.document.querySelector(`[data-action="${a}"]`);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

/* ---------- 1. Чистый статус: обычный патруль ---------- */
{
  const w = boot(save({ legal: 0 }));
  await wait(900);
  const text = content(w);
  check('чистому — «Патрулировать»', /Патрулировать/.test(text) && !/Пиратство/.test(text));
  check('и никакого предупреждения о розыске', !/Вы в розыске/.test(text));
  // Контрольный опыт для §118: без чужой вкладки действие ПИШЕТ сейв.
  // Иначе проверка «сохранение заблокировано» ниже ничего не доказывала бы.
  const raw0 = w.localStorage.getItem(SAVE_KEY);
  click(w, byAction(w, 'patrol'));
  await wait(400);
  check('без соседа действие сохраняется', w.localStorage.getItem(SAVE_KEY) !== raw0);
  w.close();
}

/* ---------- 2. Розыск: пиратство и предупреждение ---------- */
{
  const w = boot(save({ legal: 128 }));
  await wait(900);
  const text = content(w);
  check('в розыске кнопка — «Пиратство»', /Пиратство/.test(text));
  check('и сказано, чем это грозит', /Вы в розыске: 128 \(Беглец\)/.test(text),
    text.match(/Вы в розыске:[^.]*/)?.[0] ?? '');
  check('названы последствия', /полиция будет атаковать/i.test(text) && /\+64/.test(text));
  w.close();
}

/* ---------- 3. Чужая вкладка: предупреждение и стоп сохранения ---------- */
{
  const w = boot(save({ legal: 0 }), { [TAB_KEY]: foreignTab(0) });
  await wait(900);
  const raw0 = w.localStorage.getItem(SAVE_KEY);
  check('видно предупреждение о второй вкладке', /Игра открыта в другой вкладке/.test(content(w)));
  // Играть можно, но запись в localStorage не идёт: иначе мы затрём чужую.
  // Проверяем на действии, которое сохраняет всегда, — «Патрулировать».
  click(w, byAction(w, 'patrol'));
  await wait(400);
  check('и сохранение заблокировано', w.localStorage.getItem(SAVE_KEY) === raw0);
  click(w, byAction(w, 'tab-take'));
  await wait(400);
  check('«Играть здесь» снимает предупреждение', !/Игра открыта в другой вкладке/.test(content(w)));
  const tab = JSON.parse(w.localStorage.getItem(TAB_KEY));
  check('и забирает хозяина сейва', tab.id !== 'other-tab', `id=${tab.id}`);
  w.close();
}

/* ---------- 4. Перезагрузка — не вторая вкладка ---------- */
{
  const w = boot(save({ legal: 0 }));
  await wait(900);
  check('своя метка записана', w.localStorage.getItem(TAB_KEY) !== null);
  // F5: страница уходит, метка снимается — и следующая загрузка не
  // принимает саму себя за соседнюю вкладку.
  w.dispatchEvent(new w.Event('pagehide'));
  check('уходя, вкладка снимает метку', w.localStorage.getItem(TAB_KEY) === null);
  w.close();
}

/* ---------- 5. Замолчавшая вкладка ничего не блокирует ---------- */
{
  const w = boot(save({ legal: 0 }), { [TAB_KEY]: foreignTab(60_000) });
  await wait(900);
  check('закрытая вкладка не мешает', !/Игра открыта в другой вкладке/.test(content(w)));
  const tab = JSON.parse(w.localStorage.getItem(TAB_KEY));
  check('вкладка забрала хозяина себе', tab.id !== 'other-tab');
  w.close();
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
