/**
 * §132.9: КАРТОЧКА ВЫБРАННОЙ СИСТЕМЫ НА КАРТЕ.
 *
 * Пользователь: «"Вы уже в этой системе" расположи в правом верхнем углу.
 * Описание сделай по принципу: Правительство: Диктатура (правительство слева,
 * Диктатура справа)».
 *
 * Проверяется смысл, а не вёрстка:
 *   1. причина отказа стоит в строке заголовка, ПОСЛЕ имени системы (значит —
 *      справа от него), а не отдельной строкой под карточкой;
 *   2. описание — набор строк «Подпись: значение», по одной на величину;
 *   3. порядок «слева подпись, справа значение» соблюдён во всех строках.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildGalaxy } from '../src/core/galaxy.ts';

const systems = buildGalaxy(1);
const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///d/sc.html', virtualConsole: vc,
});
const { window } = dom;

// Холст запоминает, где нарисованы подписи систем: по ним и тапаем.
const labels = [];
// Подписи запоминаем ВМЕСТЕ с холстом: общая и местная карты рисуют одно и то
// же имя в разных координатах, и тап по чужой системе координат не сработал бы.
window.HTMLCanvasElement.prototype.getContext = function () {
  const id = this.id;
  return {
    setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
    arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){},
    fillText(t, x, y){ labels.push({ canvas: id, text: String(t), x, y }); },
    measureText: (t) => ({ width: String(t).length * 6 }),
    set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
  };
};
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
  value() { return { left: 0, top: 0, width: 360, height: 360, right: 360, bottom: 360, x: 0, y: 0 }; },
  configurable: true,
});
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 800));
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

click([...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'map'));
await wait(300);

const tapName = async (name) => {
  // Подписи собраны при отрисовке карты; для одного тапа этого достаточно.
  const local = labels.filter((l) => l.canvas === 'map-local');
  const lab = local.find((l) => l.text === name) ?? local.find((l) => l.text.startsWith(name + ' '));
  if (!lab) return false;
  window.document.getElementById('map-local').dispatchEvent(
    new window.MouseEvent('pointerdown', { bubbles: true, clientX: lab.x, clientY: lab.y }),
  );
  await wait(250);
  return true;
};

/* ---------- Своя система: причина отказа в правом верхнем углу ---------- */
const tappedHere = await tapName('LAVE');
const headedNow = window.document.querySelector('.sys-head')?.textContent?.replace(/\s+/g, ' ');
check('§132.9: удалось выбрать свою систему', tappedHere, `${headedNow} / подписи: ${[...new Set(labels.map((l) => l.text))].slice(0, 8).join(', ')}`);

const content = window.document.getElementById('content');
const head = [...content.querySelectorAll('.sys-head')].find((h) => /LAVE/.test(h.textContent ?? ''));
check('§132.9: имя системы и причина — в одной строке', !!head, head?.textContent?.replace(/\s+/g, ' '));
check('§132.9: причина стоит после имени (то есть справа)',
  (head?.firstElementChild?.tagName ?? '') === 'H2' &&
    /Вы уже в этой системе/.test(head?.lastElementChild?.textContent ?? ''),
  `${head?.firstElementChild?.tagName} → ${head?.lastElementChild?.textContent}`);
check('§132.9: причина больше не висит строкой под карточкой',
  !/Вы уже в этой системе/.test(
    [...content.querySelectorAll('.card .muted, .card .sub')]
      .map((n) => n.textContent ?? '').join(' ')),
);
check('§132.9: причина прижата к правому краю',
  /\.sys-note\s*\{[^}]*margin-left:\s*auto/.test(html));

/* ---------- Описание: «Подпись: значение» ---------- */
const info = [...content.querySelectorAll('.card .sub')].find((n) => /Экономика:/.test(n.textContent ?? ''));
check('§132.9: описание собрано парами «подпись: значение»', !!info,
  (info?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60));

const lines = (info?.textContent ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const pairs = lines.map((l) => l.match(/^([^:]+):\s*(.+)$/)).filter(Boolean);
check('§132.9: каждая строка — подпись и значение через двоеточие',
  pairs.length >= 6 && pairs.length === lines.length, `${pairs.length} из ${lines.length}`);
check('§132.9: подписи слева — экономика, правительство, техуровень, население, продуктивность, станция',
  ['Экономика', 'Правительство', 'Техуровень', 'Население', 'Продуктивность', 'Станция']
    .every((k) => pairs.some((m) => m[1].trim() === k)),
  pairs.map((m) => m[1].trim()).join(' · '));
check('§132.9: у правительства стоит название, а не прилагательное в столбик',
  /^(Анархия|Феодализм|Многопартийное|Диктатура|Коммунистическое|Конфедерация|Демократия|Корпоративное государство)$/
    .test(pairs.find((m) => m[1].trim() === 'Правительство')?.[2].trim() ?? ''),
  pairs.find((m) => m[1].trim() === 'Правительство')?.[2]);

/* ---------- Чужая система: причины нет, описание про неё ---------- */
const names = [...new Set(labels.filter((l) => l.canvas === 'map-local').map((l) => l.text))];
const other = systems.find((s) => s.name !== 'LAVE' && names.some((n) => n.startsWith(s.name)));
if (other) {
  await tapName(other.name);
  const c2 = window.document.getElementById('content');
  const head2 = [...c2.querySelectorAll('.sys-head')].find((h) => new RegExp(other.name).test(h.textContent ?? ''));
  check('§132.9: у чужой системы имя тоже в строке заголовка', !!head2, head2?.textContent?.replace(/\s+/g, ' '));
  check('§132.9: «Вы уже в этой системе» там не показывается',
    !/Вы уже в этой системе/.test(head2?.textContent ?? ''));
  const info2 = [...c2.querySelectorAll('.card .sub')].find((n) => /Экономика:/.test(n.textContent ?? ''));
  check('§132.9: описание относится к выбранной системе',
    /Правительство:/.test(info2?.textContent ?? '') && info2?.textContent !== info?.textContent);
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad === 0 ? 0 : 1);
