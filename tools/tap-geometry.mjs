/**
 * Проверка попадания пальцем в малую карту.
 *
 * jsdom не считает размеры (getBoundingClientRect даёт нули), поэтому
 * геометрию проверяем расчётом по формулам из main.ts.
 */
import { buildGalaxy, distance } from '../src/core/galaxy.ts';

const systems = buildGalaxy(1);
const lave = systems.find((s) => s.name === 'LAVE');

function localView(width, fuel, here) {
  const pad = 10;
  const height = Math.min(width, 400);
  const radius = Math.max(3, (fuel / 4) * 1.15);
  const k = Math.min((width - 2 * pad) / (2 * radius), (height - 2 * pad) / (2 * radius));
  return {
    radius, k,
    screenOf: (gx, gy) => ({
      x: width / 2 + (gx - here.x) * k,
      y: height / 2 + (gy / 2 - here.y / 2) * k,
    }),
  };
}

const v = localView(360, 20, lave);
const visible = systems.filter((s) => {
  const dx = Math.abs(s.x - lave.x), dy = Math.abs(s.y / 2 - lave.y / 2);
  return dx <= v.radius && dy <= v.radius;
});
console.log(`топливо 20: масштаб ${v.k.toFixed(1)} px/ед, видно ${visible.length} систем\n`);

// Для каждой видимой системы: попадает ли клик ровно в неё (с допуском 40)
console.log('система      экран(x,y)   клик→выбрано  верно?');
for (const s of visible) {
  const p = v.screenOf(s.x, s.y);
  // клик точно в точку
  let best = -1, bestD = 40 * 40;
  for (const cand of visible) {
    const q = v.screenOf(cand.x, cand.y);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = cand.index; }
  }
  const ok = best === s.index;
  console.log(`${s.name.padEnd(11)} (${p.x.toFixed(0).padStart(4)},${p.y.toFixed(0).padStart(3)})   ${(systems[best]?.name ?? '—').padEnd(11)}  ${ok ? '✅' : '❌'}`);
}
