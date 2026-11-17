/**
 * Кнопки «Перелёт» и «Патрулировать» / «Пиратство» (§81).
 *
 * Пользователь решил: мини-игра стыковки отключена, «Отстыковка» и
 * «Прыжок» заменены на одно действие «Перелёт». Вторая кнопка —
 * патруль, и её подпись зависит от статуса: криминальный игрок видит
 * «Пиратство», потому что правила другие (в зачёт идут все корабли).
 *
 * Проверяем:
 *  1. в блоке «Пункт назначения» есть «Перелёт»;
 *  2. есть патрульная кнопка с правильной подписью для чистого;
 *  3. «Отстыковаться» больше НЕТ в блоке;
 *  4. обе кнопки внутри карточки, и closest возвращает кнопку, а не карточку;
 *  5. перелёт без цели выключен.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/', virtualConsole: vc });
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = () => ({
  setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
  arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
  measureText: (t) => ({ width: String(t).length * 6 }),
  set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
});
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 800));

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const card = () => [...window.document.querySelectorAll('#content > .card')].find((c) => c.textContent.includes('Пункт назначения'));
const buttons = () => [...(card()?.querySelectorAll('button') ?? [])];
const byText = (t) => buttons().find((b) => b.textContent.includes(t));

check('блок «Пункт назначения» на месте', !!card());
check('в блоке есть «Перелёт»', !!byText('Перелёт'));
check('в блоке есть патрульная кнопка', !!byText('Патрулировать'), 'у чистого пилота');
check('«Отстыковаться» убрана', !byText('Отстыковаться'));

// Перелёт без цели выключен: без цели летать некуда.
const jump = byText('Перелёт');
check('перелёт без цели выключен', jump?.disabled === true);

// Клик должен уходить в кнопку, а не в карточку.
const patrolBtn = byText('Патрулировать');
const resolved = patrolBtn?.closest('[data-action]');
check(
  'клик по патрулю не уводит на карту',
  resolved === patrolBtn,
  resolved ? `ближайший: ${resolved.dataset.action}` : 'кнопка не найдена',
);

/*
 * Патруль требует 4 ракеты (решение пользователя, §78), а на старте их 3.
 * Значит кнопка обязана быть выключена И объяснить причину: молча
 * выключенная кнопка — худшее, что бывает в интерфейсе.
 */
const reason = card()?.textContent ?? '';
const explains = /Нужно 4 ракеты/.test(reason);
check('патруль выключен без ракет', patrolBtn?.disabled === true);
check('причина отказа подписана', explains, explains ? 'видно «Нужно 4 ракеты»' : 'подписи нет');

/*
 * А теперь — что патруль РАБОТАЕТ, когда всё есть. Подкладываем 4 ракеты
 * прямо в сохранение и перезагружаем страницу: так проверяется настоящий
 * путь игрока, а не подмена состояния в обход игры.
 */
const KEY = 'elite-idle-save-v1';
const save = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
if (save.state) {
  const st = JSON.parse(save.state);
  st.ship.missiles = 4;
  st.fuel = 70;
  save.state = JSON.stringify(st);
}

const dom2 = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://elite.test/',
  virtualConsole: vc,
  beforeParse(win) {
    win.HTMLCanvasElement.prototype.getContext = window.HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
    win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    win.cancelAnimationFrame = clearTimeout;
    win.localStorage.setItem(KEY, JSON.stringify(save));
  },
});
await new Promise((r) => setTimeout(r, 900));

const w2 = dom2.window;
// До старта патруля его карточки ещё нет — кнопка живёт в «Пункте назначения».
const destCard = () => [...w2.document.querySelectorAll('#content > .card')].find((c) => c.textContent.includes('Пункт назначения'));
const btn2 = [...(destCard()?.querySelectorAll('button') ?? [])].find((b) => /Патрулировать|Пиратство/.test(b.textContent));

check('с ракетами патруль доступен', btn2?.disabled === false, btn2 ? `[${btn2.textContent}]` : 'кнопки нет');

btn2?.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 500));
const destCard2 = () => [...w2.document.querySelectorAll('#content > .card')].find((c) => c.textContent.includes('Пункт назначения'));
const after = w2.document.getElementById('content').textContent;
/*
 * §82: у патруля свой вид — «Патруль: <система>», встречи и топливо.
 * Раньше проверка искала «в пути» и падала: патруль больше не притворяется
 * перелётом (и не пишет «Infinity ч»).
 */
const flying = /Патруль|Пиратство/.test(after) && /Встреч/.test(after);
check('патруль начался по кнопке', flying, flying ? 'видна карточка патруля' : 'патруля нет');
check('нет «Infinity» в интерфейсе', !/Infinity/.test(after), 'путь во времени не показывается');
check('в патруле есть кнопка «Вернуться»', [...w2.document.querySelectorAll('#content button')].some((b) => b.textContent.includes('Вернуться')));

/*
 * §81: криминальный статус меняет подпись на «Пиратство». Это не
 * украшение: правила разные, и игрок должен видеть режим до нажатия.
 */
if (save.state) {
  const st = JSON.parse(save.state);
  st.flight = null;
  st.legal = 100;
  st.ship.missiles = 4;
  st.fuel = 70;
  st.escapeRoute = [];
  st.escapeStatus = -1;
  save.state = JSON.stringify(st);
}
const dom3 = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://elite.test/',
  virtualConsole: vc,
  beforeParse(win) {
    win.HTMLCanvasElement.prototype.getContext = window.HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
    win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    win.cancelAnimationFrame = clearTimeout;
    win.localStorage.setItem(KEY, JSON.stringify(save));
  },
});
await new Promise((r) => setTimeout(r, 900));
const w3 = dom3.window;
const card3 = () => [...w3.document.querySelectorAll('#content > .card')].find((c) => c.textContent.includes('Пункт назначения'));
const labels = [...(card3()?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim());
check('у преступника кнопка зовётся «Пиратство»', labels.includes('Пиратство'), labels.join(' · '));
check('у преступника нет «Патрулировать»', !labels.includes('Патрулировать'));

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad === 0 ? 0 : 1);
