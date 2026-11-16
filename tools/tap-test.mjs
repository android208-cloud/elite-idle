import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html','utf8');
const errors=[]; const vc=new VirtualConsole().on('jsdomError',e=>errors.push(String(e)));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'file:///d/g.html',virtualConsole:vc});
const {window}=dom;
window.HTMLCanvasElement.prototype.getContext=()=>({
  setTransform(){},clearRect(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},stroke(){},fill(){},
  arc(){},save(){},restore(){},setLineDash(){},strokeRect(){},fillText(){},
  measureText:t=>({width:t.length*6}),set lineWidth(v){},set strokeStyle(v){},set fillStyle(v){},
  set font(v){},set textAlign(v){},set textBaseline(v){},set lineJoin(v){},
});
Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){return 360;},configurable:true});
window.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),16);
window.cancelAnimationFrame=clearTimeout;
await new Promise(r=>setTimeout(r,700));

const mapTab=[...window.document.querySelectorAll('[data-action="tab"]')].find(t=>t.dataset.tab==='map');
mapTab.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
await new Promise(r=>setTimeout(r,200));

const local = window.document.getElementById('map-local');
console.log('малая карта:', !!local, '| data-local =', local?.dataset.local);
console.log('getBoundingClientRect:', JSON.stringify(local.getBoundingClientRect()));

// Клик в центр малой карты
local.dispatchEvent(new window.MouseEvent('click',{bubbles:true, clientX:180, clientY:180}));
await new Promise(r=>setTimeout(r,200));

const cards = [...window.document.querySelectorAll('.card')];
const infoCard = cards[cards.length-1];
console.log('карточка после клика:', infoCard?.textContent?.replace(/\s+/g,' ').slice(0,90));
console.log('ошибки:', errors.length?errors[0].slice(0,100):'нет');
process.exit(0);
