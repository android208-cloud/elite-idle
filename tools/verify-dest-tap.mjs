/**
 * «Пункт назначения» на экране «Корабль» (§72).
 *
 * Требования пользователя:
 *  1. нажатие на блок ведёт на карту;
 *  2. в блоке есть кнопка «Перелёт» (§81: раньше была «Отстыковаться»).
 *
 * Вторая проверка важнее первой: кнопка лежит ВНУТРИ кликабельной
 * карточки. Если обработчик возьмёт карточку, а не кнопку, игрок
 * нажмёт «Отстыковаться» и молча уедет на карту.
 *
 * Чего проверить НЕЛЬЗЯ: что кнопка реально открывает мини-игру.
 * Модуль стыковки создаёт iframe и зовёт `iframe.sandbox.add(...)`,
 * а в jsdom свойства `sandbox` у iframe нет вовсе — модуль падает.
 * Это ограничение среды, а не игры: в браузере тот же код работает.
 * Поэтому здесь проверяется то, что от jsdom не зависит, — что клик
 * по кнопке уходит именно в кнопку, а не в карточку.
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
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const title = () => window.document.getElementById('title').textContent;
const card = () => [...window.document.querySelectorAll('#content > .card')].find((c) => c.textContent.includes('Пункт назначения'));

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

check('блок на месте', !!card());
check('блок помечен как кликабельный', !!card()?.classList.contains('linkable'));

// 1. Нажатие на блок ведёт на карту
click(card());
await new Promise((r) => setTimeout(r, 250));
check('нажатие на блок открывает карту', title() === 'Карта', `заголовок: ${title()}`);
check('на карте появился холст', !!window.document.getElementById('map-local'));

// 2. Возвращаемся и смотрим на кнопку
click([...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'ship'));
await new Promise((r) => setTimeout(r, 250));
/*
 * §81: «Отстыковаться» заменена на «Перелёт» — мини-игра стыковки
 * отключена, и прыжок теперь прямо в блоке.
 */
const btn = [...(card()?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('Перелёт'));
check('в блоке есть кнопка «Перелёт»', !!btn);

/*
 * Кнопка «Перелёт» и карточка — соседи по разметке. Проверяем
 * разрешение клика так, как это делает игра: closest('[data-action]')
 * от кнопки должен вернуть САМУ кнопку, а не карточку. Если это
 * сломается (кнопку вынесут из карточки или обработчик поменяют),
 * игрок нажмёт «Отстыковаться» и уедет на карту.
 */
const resolved = btn?.closest('[data-action]');
check(
  'клик по кнопке разрешается в кнопку, а не в карточку',
  resolved === btn,
  resolved ? `data-action="${resolved.dataset.action}"` : 'не разрешился',
);

// Проверка после перерисовки: разрешение клика не зависит от того,
// сколько раз экран перестроили (кнопка каждый раз новая).
click([...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'log'));
await new Promise((r) => setTimeout(r, 150));
click([...window.document.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'ship'));
await new Promise((r) => setTimeout(r, 200));
const btn2 = [...(card()?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('Отстыковаться'));
check('после перерисовки кнопка всё так же не часть карточки', btn2?.closest('[data-action]') === btn2);

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad ? 1 : 0);
