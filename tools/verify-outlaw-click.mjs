/**
 * §96: клик «Напасть» на пирата, летящего мимо, — в патруле.
 *
 * История бага. §95 исправил правило в карточке встречи, но обработчик
 * нажатия считал решения по-старому — без роли. Игрок видел активную
 * кнопку «Напасть», жал её и получал в журнале «Это решение сейчас
 * недоступно». Тест ядра такое НЕ ловит: расхождение было в UI.
 *
 * Проверка идёт через настоящий DOM и настоящий обработчик клика:
 *
 *   1. готовим состояние «патруль + пират летит мимо»;
 *   2. загружаем игру с ним;
 *   3. жмём «Напасть» так, как это делает палец;
 *   4. убеждаемся, что отказа в журнале НЕТ и встреча закрылась.
 *
 * Две ловушки, на которых эта проверка падала при разработке, — их надо
 * помнить, иначе «проверка» будет проверять пустоту:
 *
 *   • состояние в localStorage хранится СТРОКОЙ и пишется через
 *     `serialize`, а не `JSON.stringify`: у патруля `arriveAt` и
 *     `remainingBaseMs` бесконечны, и обычный `JSON.stringify` превращает
 *     их в `null` — патруль «прибывает» сразу после загрузки;
 *   • тик (раз в секунду) вызывает `advance`, который гасит встречу с
 *     `outcome: 'leave'` при досчёте. Поэтому тик в проверке отключён:
 *     подменяем `setInterval` с задержкой 1000. Код игры не трогаем.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};
const flat = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const vc = new VirtualConsole();

const { serialize, deserialize, startPatrol } = await import('/home/user/elite-idle/src/core/state.ts');

// 1. Готовим состояние: пиратство, полный набор, встреча «пират мимо».
const seed = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
await new Promise((r) => setTimeout(r, 300));
const raw = JSON.parse(seed.window.localStorage.getItem('elite-idle-save-v1'));
let st = deserialize(raw.state);
st = { ...st, legal: 60, fuel: 70, cash: 20000, ship: { ...st.ship, laser: 'military', missiles: 4, ecm: true, energyBomb: true } };
st = startPatrol(st, Date.now()).state;
st = { ...st, encounter: { role: 'pirate', enemyId: 'sidewinder', detectedAt: Date.now(), resolveAt: Date.now() + 300000, outcome: 'leave' } };
raw.state = serialize(st);

// 2. Загружаем с этим состоянием, тик отключён (см. шапку файла).
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://localhost/',
  beforeParse(win) {
    win.localStorage.setItem('elite-idle-save-v1', JSON.stringify(raw));
    const real = win.setInterval.bind(win);
    win.setInterval = (fn, ms, ...rest) => (ms === 1000 ? 0 : real(fn, ms, ...rest));
  },
});
const w = dom.window;
await new Promise((r) => w.addEventListener('load', r, { once: true }));
await new Promise((r) => setTimeout(r, 250));
const d = w.document;

// 3. Экран в патруле, карточка встречи на месте.
const titles = [...d.querySelectorAll('#content .card h2')].map(flat);
check('идёт патруль', titles.some((t) => /Пиратство|Патруль/.test(t)), titles[0] ?? '—');
const card = [...d.querySelectorAll('#content .card')].find((c) => c.textContent.includes('В радиусе'));
check('карточка встречи видна', !!card, flat(card?.querySelector('h2')) ?? 'нет');

if (card) {
  const atk = [...card.querySelectorAll('button')].find((b) => flat(b) === 'Напасть');
  check('кнопка «Напасть» на пирата мимо активна', !!atk && !atk.disabled,
    atk ? (atk.disabled ? 'выключена' : 'активна') : 'нет кнопки');

  if (atk && !atk.disabled) {
    atk.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 300));
    const txt = flat(d.getElementById('content'));
    check('НЕТ отказа «это решение сейчас недоступно»', !/сейчас недоступно/.test(txt));
    check('встреча закрыта после нападения',
      ![...d.querySelectorAll('#content .card')].some((c) => c.textContent.includes('В радиусе')));
  }
}

// 4. Ядро: то же правило, что использует обработчик.
const { availableDecisions, applyDecision, bestLaserOf, isLegalTarget } = await import('/home/user/elite-idle/src/core/one-decision.ts');
const { enemyById } = await import('/home/user/elite-idle/src/core/ships.ts');
const best = bestLaserOf({ pulse: false, beam: false, military: true, mining: false });
check('правило: пират мимо — законная цель', isLegalTarget('pirate', false));
check('правило: торговец мимо — не цель', !isLegalTarget('trader', false));
const canP = availableDecisions(enemyById('sidewinder'), best, true, isLegalTarget('pirate', false));
check('на пирата решение исполняется', !!applyDecision(enemyById('sidewinder'), 'attack', canP, false));
const canT = availableDecisions(enemyById('cobra3'), best, true, isLegalTarget('trader', false));
check('на торговца решения нет', applyDecision(enemyById('cobra3'), 'attack', canT, false) === null);

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
