import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://elite.test/', virtualConsole: vc,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => ({ setTransform(){},clearRect(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},save(){},restore(){},setLineDash(){},strokeRect(){},fillText(){},measureText:(t)=>({width:6}), set lineWidth(v){},set strokeStyle(v){},set fillStyle(v){},set font(v){},set textAlign(v){},set textBaseline(v){},set lineJoin(v){} });
    w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    w.cancelAnimationFrame = clearTimeout;
    w.confirm = (t) => { console.log('CONFIRM вызван:', JSON.stringify(t.slice(0,40))); return false; };
  } });
const w = dom.window;
await new Promise(r => setTimeout(r, 900));
const doc = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
click([...doc.querySelectorAll('[data-action="tab"]')].find(t => t.dataset.tab === 'log'));
await new Promise(r => setTimeout(r, 200));
console.log('карточка есть:', /Прогресс в файле/.test(doc.getElementById('content').textContent));
const input = doc.getElementById('load-file-input');
console.log('input найден:', !!input);
const file = new w.File(['{"app":"elite-idle","fileVersion":1,"state":"{}"}'], 'x.json');
Object.defineProperty(input, 'files', { value: [file], configurable: true });
input.dispatchEvent(new w.Event('change', { bubbles: true }));
await new Promise(r => setTimeout(r, 600));
const t = doc.getElementById('content').textContent;
console.log('в тексте «повреждён»:', /повреждён/.test(t));
console.log('фрагмент:', t.match(/x\.json[^]{0,80}/)?.[0] ?? 'нет упоминания файла');
