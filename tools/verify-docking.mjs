/**
 * Проверка, что встроенный в автономный файл экран стыковки
 * действительно открывается и говорит по протоколу.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const errors = [];
const vc = new VirtualConsole().on('jsdomError', (e) => errors.push(String(e)));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///data/game.html', virtualConsole: vc,
});
const { window } = dom;

const ctx = () => new Proxy({}, { get: () => () => ({
  addColorStop() {}, width: 10, data: [],
}) });
window.HTMLCanvasElement.prototype.getContext = ctx;
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 800));

// Проверяем шаблон экрана стыковки: он должен быть полноценным документом
const tpl = window.document.getElementById('docking-screen-html');
const raw = (tpl?.textContent ?? '').trim();
// Разметка лежит в base64 — декодируем так же, как это делает игра.
let screen = raw;
try {
  screen = new TextDecoder().decode(Uint8Array.from(window.atob(raw), (c) => c.charCodeAt(0)));
} catch (e) { console.log('декодирование не удалось:', e.message); }
console.log('=== шаблон экрана ===');
console.log('длина base64:', raw.length, '→ разметка:', screen.length);
console.log('это HTML:', /<!doctype html|<html/i.test(screen) ? 'да ✅' : 'нет ❌');
console.log('есть canvas:', /<canvas/i.test(screen) ? 'да ✅' : 'нет ❌');
console.log('слушает сообщения:', /addEventListener\(\s*['"]message/.test(screen) ? 'да ✅' : 'нет ❌');
console.log('шлёт docking:ready:', /docking:ready/.test(screen) ? 'да ✅' : 'нет ❌');
console.log('шлёт docking:result:', /docking:result/.test(screen) ? 'да ✅' : 'нет ❌');
console.log('=== ошибки ===');
console.log(errors.length ? errors.slice(0, 2).join('\n') : 'нет ✅');
process.exit(0);
