/**
 * Проверяет, что модель рисуется для КАЖДОГО корабля парка.
 *
 * Модель встречи — это тот же drawShipModel с другим блюпринтом.
 * Если у какого-то корабля грани или рёбра разобраны неверно, рендер
 * либо бросит исключение, либо зальёт меньше четырёх фигур (силуэт
 * плюс три грани) — то есть корпус останется пустым.
 *
 * §109: здесь же проверяется, что контур корпуса НЕ светится. Раньше
 * рёбра обводились ярким `#4fd8c4`, и на скриншоте пользователя вокруг
 * Питона шла неоновая окантовка. Теперь контур тёмный — темнее любой
 * грани: он держит силуэт, но не светится. Проверка сторожит возврат
 * яркой линии: светлый контур видно на глаз, но не в тестах заливок.
 *
 * Внешний вид всё равно надо смотреть: tools/render-fleet.mjs.
 */
import { FLEET, drawShipModel } from '../src/ui/ship-model.ts';

const mod = { FLEET, drawShipModel };

/** Записывающая «кисть»: считает фигуры и запоминает цвет каждой линии. */
function recorder() {
  const calls = [];
  const strokes = [];
  return {
    calls,
    strokes,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    setTransform() {}, clearRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, save() {}, restore() {}, setLineDash() {},
    fill() { calls.push('fill'); },
    stroke() { calls.push('stroke'); strokes.push(this.strokeStyle); },
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
}

/** Максимальный канал цвета: по нему и видно, светится ли линия. */
function brightest(style) {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(style));
  if (hex) {
    const v = parseInt(hex[1], 16);
    return Math.max((v >> 16) & 255, (v >> 8) & 255, v & 255);
  }
  const rgb = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(String(style));
  if (rgb) return Math.max(+rgb[1], +rgb[2], +rgb[3]);
  return 255; // неизвестный формат считаем ярким: лучше упасть, чем смолчать
}

const LIGHT_LIMIT = 60; // #0b1e1b → 30; прежний #4fd8c4 → 196
let bad = [];
const failed = new Set();
const ids = Object.keys(mod.FLEET);
for (const id of ids) {
  const ctx = recorder();
  try { mod.drawShipModel(ctx, { width: 300, height: 130, yaw: 0.7, ship: mod.FLEET[id] }); }
  catch (e) { bad.push(id + ': ' + e.message); failed.add(id); continue; }

  const fills = ctx.calls.filter((c) => c === 'fill').length;
  if (fills < 4) { bad.push(`${id}: заливок ${fills}`); failed.add(id); }

  const bright = ctx.strokes.filter((s) => brightest(s) > LIGHT_LIMIT);
  if (bright.length) { bad.push(`${id}: светлый контур ${[...new Set(bright)].join(', ')}`); failed.add(id); }
}

// Второй проход — по «голому» вызову без ship: там включается модель
// игрока по умолчанию. Она рисуется тем же кодом, но проверить не вредно.
{
  const ctx = recorder();
  try { mod.drawShipModel(ctx, { width: 300, height: 130, yaw: 0.7 }); }
  catch (e) { bad.push('модель по умолчанию: ' + e.message); }
  const bright = ctx.strokes.filter((s) => brightest(s) > LIGHT_LIMIT);
  if (bright.length) bad.push(`модель по умолчанию: светлый контур ${[...new Set(bright)].join(', ')}`);
}

console.log('кораблей нарисовано без ошибок:', ids.length - failed.size, 'из', ids.length);
console.log(`контур не светится: лимит яркости ${LIGHT_LIMIT}`);
if (bad.length) console.log('проблемы:', bad.join('; '));
process.exit(bad.length ? 1 : 0);
