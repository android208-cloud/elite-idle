/**
 * Цвет карточки встречи (§85).
 *
 * Пользователь: «красить карточку. Полицию и охотника различать только,
 * если враждебны, а так — зелёный».
 *
 * Правило: угроза красная, всё остальное зелёное. Жёлтого больше нет —
 * раньше карточка была жёлтой ВСЕГДА, то есть цвет не нёс информации.
 *
 * Модель корабля не красится — так решил пользователь.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();

function make(store) {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://elite.test/',
    virtualConsole: vc,
    beforeParse(win) {
      win.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
        arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
        measureText: (t) => ({ width: String(t).length * 6 }),
        set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){},
        set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
      });
      Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
      win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      win.cancelAnimationFrame = clearTimeout;
      if (store) win.localStorage.setItem('elite-idle-save-v1', store);
    },
  });
}

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const base = make(null);
await new Promise((r) => setTimeout(r, 900));
const template = JSON.parse(base.window.localStorage.getItem('elite-idle-save-v1'));

/**
 * Встреча в НАСТОЯЩЕМ перелёте: `to !== from`, прибытие далеко в будущем.
 *
 * Важно: подложить `to === from` нельзя — движок считает такой полёт
 * прибывшим и гасит встречу при первом же досчёте.
 */
async function encounter({ role, enemy, outcome, legal = 0 }) {
  const save = JSON.parse(JSON.stringify(template));
  const st = JSON.parse(save.state);
  const now = Date.now();
  st.legal = legal;
  st.cargo = Array(17).fill(0);
  st.ship.missiles = 4;
  st.flight = {
    from: st.system,
    to: (st.system + 1) % 256,
    departAt: now,
    arriveAt: now + 9e9,
    fuelUsed: 1,
    remainingBaseMs: 9e9,
    elapsedBaseMs: 0,
    dueAt: now,
    encounters: 1,
    lastEncounterAt: now,
  };
  st.encounter = { role, enemyId: enemy, detectedAt: now, resolveAt: now + 300_000, outcome };
  save.state = JSON.stringify(st);

  const dom = make(JSON.stringify(save));
  await new Promise((r) => setTimeout(r, 900));
  const w = dom.window;
  const card = [...w.document.querySelectorAll('#content .card')].find((c) => c.textContent.includes('В радиусе'));
  return card?.className ?? '';
}

const tone = (cls) => (cls.includes('danger') ? 'красная' : cls.includes('calm') ? 'зелёная' : cls.includes('warn') ? 'жёлтая' : 'нет');

/* Мирные — зелёные */
for (const [name, args] of [
  ['торговец', { role: 'trader', enemy: 'cobra3', outcome: 'leave' }],
  ['полиция, чистый пилот', { role: 'police', enemy: 'viper', outcome: 'leave' }],
  ['охотник, летящий мимо', { role: 'hunter', enemy: 'cobra1', outcome: 'leave' }],
]) {
  const cls = await encounter(args);
  check(`${name} — зелёная`, cls.includes('calm'), `class="${cls}"`);
}

/* §86: пират, который пока не атакует, — жёлтый */
{
  const cls = await encounter({ role: 'pirate', enemy: 'sidewinder', outcome: 'leave' });
  check('пират, летящий мимо — жёлтая', cls.includes('warn'), `class="${cls}"`);
}

/* Угрозы — красные */
for (const [name, args] of [
  ['пират атакует', { role: 'pirate', enemy: 'sidewinder', outcome: 'attack' }],
  ['полиция ищет (статус 60)', { role: 'police', enemy: 'viper', outcome: 'attack', legal: 60 }],
  ['охотник ищет (статус 60)', { role: 'hunter', enemy: 'cobra1', outcome: 'attack', legal: 60 }],
]) {
  const cls = await encounter(args);
  check(`${name} — красная`, cls.includes('danger'), `class="${cls}"`);
}

/* Мирный торговец жёлтым не бывает — жёлтый только у пирата и розыска */
{
  const cls = await encounter({ role: 'trader', enemy: 'cobra3', outcome: 'leave' });
  check('торговец не жёлтый', !cls.includes('warn'), `class="${cls}"`);
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad === 0 ? 0 : 1);
