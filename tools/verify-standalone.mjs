import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file:///data/elite-idle.html',
  virtualConsole: new (await import('jsdom')).VirtualConsole().on('jsdomError', (e) => errors.push(String(e))),
});

const { window } = dom;
// canvas недоступен в jsdom без пакета — заглушим, игра рисует карту
window.HTMLCanvasElement.prototype.getContext = () => ({
  fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  fill() {}, arc() {}, closePath() {}, save() {}, restore() {}, translate() {}, rotate() {},
  scale() {}, setTransform() {}, fillText() {}, measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }), setLineDash() {}, drawImage() {},
  strokeRect() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {}, roundRect() {},
  getImageData: () => ({ data: [] }), putImageData() {}, clip() {}, rect() {},
});
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = clearTimeout;

await new Promise((r) => setTimeout(r, 1200));

const app = window.document.getElementById('app');
const text = (app?.textContent ?? '').replace(/\s+/g, ' ').trim();

console.log('=== ошибки ===');
console.log(errors.length ? errors.slice(0, 3).join('\n') : 'нет ✅');
console.log('=== разметка отрисована? ===');
console.log('длина текста:', text.length);
console.log('первые 260 символов:');
console.log(text.slice(0, 260));
console.log('=== экран стыковки найден? ===');
console.log(!!window.document.getElementById('docking-screen-html') ? 'да ✅' : 'НЕТ ❌');
process.exit(0);
