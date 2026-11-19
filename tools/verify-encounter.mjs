/**
 * Проверяет, что модель рисуется для КАЖДОГО корабля парка.
 *
 * Модель встречи — это тот же drawShipModel с другим блюпринтом.
 * Если у какого-то корабля грани или рёбра разобраны неверно, рендер
 * либо бросит исключение, либо зальёт меньше четырёх фигур (силуэт
 * плюс три грани) — то есть корпус останется пустым.
 *
 * §110: здесь же проверяется, что поверх заливки НЕТ ЛИНИЙ.
 *
 * История: рёбра сначала обводились ярким `#4fd8c4` (§69), потом тёмным
 * `rgb(11,30,27)` (§109). Обе обводки — тонкая линия, которая при
 * вращении ползёт по пикселям: антиалиасинг то показывает её, то прячет,
 * и пользователь видел «мигают некоторые рёбра». Теперь линий нет вовсе,
 * а единственная допустимая обводка — шов: полигон заливается своей же
 * краской с обводкой в 1 px, чтобы между соседними гранями не оставалось
 * волосяной щели. Инвариант проверки: каждая `stroke()` идёт сразу после
 * `fill()` и тем же цветом.
 *
 * Внешний вид всё равно надо смотреть: tools/render-fleet.mjs.
 */
import { FLEET, drawShipModel } from '../src/ui/ship-model.ts';

const mod = { FLEET, drawShipModel };

/** Записывающая «кисть»: считает фигуры и запоминает цвет каждой линии. */
function recorder() {
  const calls = [];
  const strokes = [];
  let lastFill = null;
  return {
    calls,
    strokes,
    seamStrokes: 0,
    strayStrokes: [],
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    setTransform() {}, clearRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, save() {}, restore() {}, setLineDash() {},
    fill() { calls.push('fill'); lastFill = this.fillStyle; },
    stroke() {
      calls.push('stroke');
      strokes.push(this.strokeStyle);
      // Шов: та же краска, что у только что залитого полигона.
      if (lastFill !== null && lastFill === this.strokeStyle) this.seamStrokes++;
      else this.strayStrokes.push(this.strokeStyle);
    },
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
}

let bad = [];
const failed = new Set();
const ids = Object.keys(mod.FLEET);
const samples = [['python', 'Python'], ['cobra3', 'Cobra Mk III'], ['sidewinder', 'Sidewinder']];

for (const id of ids) {
  const ctx = recorder();
  try { mod.drawShipModel(ctx, { width: 300, height: 130, yaw: 0.7, ship: mod.FLEET[id] }); }
  catch (e) { bad.push(id + ': ' + e.message); failed.add(id); continue; }

  const fills = ctx.calls.filter((c) => c === 'fill').length;
  if (fills < 4) { bad.push(`${id}: заливок ${fills}`); failed.add(id); }

  if (ctx.strayStrokes.length) {
    bad.push(`${id}: линии поверх заливки ${[...new Set(ctx.strayStrokes)].join(', ')}`);
    failed.add(id);
  }
}

// Второй проход — «голый» вызов без ship: там включается модель игрока
// по умолчанию. Она рисуется тем же кодом, но проверить не вредно.
{
  const ctx = recorder();
  try { mod.drawShipModel(ctx, { width: 300, height: 130, yaw: 0.7 }); }
  catch (e) { bad.push('модель по умолчанию: ' + e.message); failed.add('default'); }
  if (ctx.strayStrokes.length) {
    bad.push(`модель по умолчанию: линии ${[...new Set(ctx.strayStrokes)].join(', ')}`);
    failed.add('default');
  }
}

// Третий проход — по всему обороту: линия могла бы всплыть только на
// каком-то угле, а модель крутится 24 секунды и проходит все углы.
for (const [id, name] of samples) {
  let strays = 0;
  for (let i = 0; i < 72; i++) {
    const ctx = recorder();
    drawShipModel(ctx, { width: 300, height: 130, yaw: (i / 72) * Math.PI * 2, ship: mod.FLEET[id] });
    strays += ctx.strayStrokes.length;
  }
  if (strays) { bad.push(`${name}: посторонних линий за оборот ${strays}`); failed.add(id); }
}

console.log('кораблей нарисовано без ошибок:', ids.length - [...failed].filter((f) => ids.includes(f)).length, 'из', ids.length);
console.log('линий поверх заливки нет (только швы тем же цветом)');
if (bad.length) console.log('проблемы:', bad.join('; '));
process.exit(bad.length ? 1 : 0);
