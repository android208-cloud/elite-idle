/**
 * Проверяет, что модель рисуется для КАЖДОГО корабля парка.
 *
 * Модель встречи — это тот же drawShipModel с другим блюпринтом.
 * Если у какого-то корабля грани или рёбра разобраны неверно, рендер
 * либо бросит исключение, либо зальёт меньше четырёх фигур (силуэт
 * плюс три грани) — то есть корпус останется пустым.
 *
 * Внешний вид всё равно надо смотреть: tools/render-fleet.mjs.
 */
import { FLEET, drawShipModel } from '../src/ui/ship-model.ts';

const mod = { FLEET, drawShipModel };
let bad = [];
for (const id of Object.keys(mod.FLEET)) {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'measureText') return (t) => ({ width: String(t).length * 6 });
      return (...a) => { calls.push(k); };
    },
    set() { return true; },
  });
  try { mod.drawShipModel(ctx, { width: 300, height: 130, yaw: 0.7, ship: mod.FLEET[id] }); }
  catch (e) { bad.push(id + ': ' + e.message); continue; }
  const fills = calls.filter((c) => c === 'fill').length;
  if (fills < 4) bad.push(`${id}: заливок ${fills}`);
}
console.log('кораблей нарисовано без ошибок:', Object.keys(mod.FLEET).length - bad.length, 'из', Object.keys(mod.FLEET).length);
if (bad.length) console.log('проблемы:', bad.join('; '));
process.exit(bad.length ? 1 : 0);
