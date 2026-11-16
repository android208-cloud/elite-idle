/**
 * Модель корабля и карта — проверки геометрии.
 *
 * Обе вещи ломаются молча: карта рисуется, но точки уезжают за холст;
 * корабль рисуется, но обрезается на части углов поворота. Глазами
 * такое видно не сразу, а тестом — сразу.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGalaxy, distance } from '../src/core/galaxy.ts';

/* ---------- Локальная карта после поворота на 90° ---------- */

/**
 * Копия `mapView` из `main.ts`. Проверяем математику, а не DOM:
 * обещанное «круг дальности остаётся кругом» ломается молча.
 */
function mapView(width: number, fuel: number, here: { x: number; y: number }) {
  const height = Math.round(Math.min(width * 1.55, 620));
  const pad = 16;
  const MARGIN = 1.35;
  const radius = Math.max(4, (fuel / 4) * MARGIN);
  const kx = Math.min((width - 2 * pad) / (2 * radius), (height - 2 * pad) / (2 * radius));
  const ky = kx / 2; // distance() считает dy/2 — по Y вдвое «дешевле»
  return {
    width,
    height,
    kx,
    ky,
    radius,
    screenX: (gx: number) => width / 2 + (gx - here.x) * kx,
    screenY: (gy: number) => height / 2 + (gy - here.y) * ky,
    visible: (s: { x: number; y: number }) =>
      Math.abs(s.x - here.x) <= radius * 1.15 && Math.abs(s.y - here.y) <= radius * 2 * 1.15,
  };
}

test('карта: круг дальности круглый, а не эллипс', () => {
  // distance() = 4·hypot(dx, dy/2). Если масштаб по Y не вдвое меньше,
  // круг превращается в эллипс и карта врёт о дальности прыжка.
  const v = mapView(360, 70, { x: 100, y: 100 });
  const R = 70 / 4;
  const cx = v.width / 2;
  const cy = v.height / 2;
  const alongX = Math.hypot(v.screenX(100 + R) - cx, v.screenY(100) - cy);
  const alongY = Math.hypot(v.screenX(100) - cx, v.screenY(100 + R * 2) - cy);
  assert.ok(Math.abs(alongX - alongY) < 0.5, `по X ${alongX.toFixed(1)} px, по Y ${alongY.toFixed(1)} px`);
});

test('карта: все достижимые системы попадают в окно', () => {
  // Реальные данные галактики 1: раньше 110 систем из 256 уезжали за край.
  const systems = buildGalaxy(1);
  for (const here of systems) {
    for (const fuel of [20, 40, 70]) {
      const v = mapView(360, fuel, here);
      for (const s of systems) {
        if (distance(here, s) > fuel) continue;
        assert.ok(
          v.visible(s),
          `${here.name} топливо ${fuel}: достижимая ${s.name} не видна`,
        );
      }
    }
  }
});

test('карта: окно небольшое — выбирать пальцем реально', () => {
  // Вся галактика (256 систем) на экране телефона — каша, попасть
  // невозможно. В окне вокруг корабля их единицы-десятки.
  // Замер по реальной галактике 1: медиана 20, максимум 32 при полном
  // баке. 32 точки на 360 px — примерно одна на 64 px, это нормально
  // для пальца (радиус попадания 44 px ещё и с запасом).
  const systems = buildGalaxy(1);
  let worst = 0;
  let median = 0;
  const counts: number[] = [];
  for (const here of systems) {
    const v = mapView(360, 70, here);
    counts.push(systems.filter((s) => v.visible(s)).length);
  }
  counts.sort((a, b) => a - b);
  worst = counts[counts.length - 1];
  median = counts[Math.floor(counts.length / 2)];

  assert.ok(worst <= 40, `в окне до ${worst} систем — слишком много`);
  assert.ok(median <= 25, `медиана ${median} систем — тесновато`);
  assert.ok(worst >= 3, 'в окне должно быть хотя бы несколько систем');
});

test('карта: X галактики идёт вниз, Y — вправо', () => {
  const v = mapView(360, 70, { x: 128, y: 128 });
  // Рост X должен увеличивать экранную вертикаль, но не горизонталь.
  assert.ok(v.screenX(200) > v.screenX(128), 'рост X должен вести вниз');
  assert.equal(v.screenY(128), v.screenY(128));
  // Рост Y — наоборот.
  assert.ok(v.screenY(200) > v.screenY(128), 'рост Y должен вести вправо');
});

/* ---------- Модель корабля ---------- */

// Та же геометрия, что в src/ui/ship-model.ts (извлечена из оригинала).
const V: [number, number, number][] = [
  [32, 0, 76], [-32, 0, 76], [0, 26, 24], [-120, -3, -8], [120, -3, -8], [-88, 16, -40], [88, 16, -40], [128, -8, -40],
  [-128, -8, -40], [0, 26, -40], [-32, -24, -40], [32, -24, -40], [-36, 8, -40], [-8, 12, -40], [8, 12, -40], [36, 8, -40],
  [36, -12, -40], [8, -16, -40], [-8, -16, -40], [-36, -12, -40], [0, 0, 76], [0, 0, 90], [-80, -6, -40], [-80, 6, -40],
  [-88, 0, -40], [80, 6, -40], [88, 0, -40], [80, -6, -40],
];
const E: [number, number][] = [
  [0, 1], [0, 4], [1, 3], [3, 8], [4, 7], [6, 7], [6, 9], [5, 9], [5, 8], [2, 5], [2, 6], [3, 5],
  [4, 6], [1, 2], [0, 2], [8, 10], [10, 11], [7, 11], [1, 10], [0, 11], [1, 5], [0, 6], [20, 21], [12, 13],
  [18, 19], [14, 15], [16, 17], [15, 16], [14, 17], [13, 18], [12, 19], [2, 9], [22, 24], [23, 24], [22, 23], [25, 26],
  [26, 27], [25, 27],
];

function projectShip(width: number, height: number, yaw: number) {
  const pitch = 0.28;
  const scale = Math.min(width, height) * 0.0072;
  const dist = 620;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return V.map(([vx, vy, vz]) => {
    const x1 = vx * cy + vz * sy;
    const z1 = -vx * sy + vz * cy;
    const y2 = vy * cp - z1 * sp;
    const z2 = vy * sp + z1 * cp;
    const k = (dist / (z2 + dist)) * scale;
    return { x: width / 2 + x1 * k, y: height / 2 + y2 * k };
  });
}

test('Cobra Mk III: 28 вершин и 38 рёбер, все индексы валидны', () => {
  // Ровно столько в оригинале (ShipCobraMkIIIPirateBlueprint, +3 и +4).
  assert.equal(V.length, 28);
  assert.equal(E.length, 38);
  for (const [a, b] of E) {
    assert.ok(a >= 0 && a < V.length, `ребро ссылается на вершину ${a}`);
    assert.ok(b >= 0 && b < V.length, `ребро ссылается на вершину ${b}`);
    assert.notEqual(a, b, 'ребро не может соединять вершину саму с собой');
  }
});

test('Cobra Mk III: все 28 вершин задействованы в рёбрах', () => {
  // Если вершина не используется, значит разбор таблицы сбился.
  const used = new Set(E.flat());
  assert.equal(used.size, 28);
});

test('Cobra Mk III: симметрична по X', () => {
  // У настоящей Cobra левая и правая половины зеркальны.
  const xs = V.map((v) => v[0]).sort((a, b) => a - b);
  assert.equal(xs[0], -xs[xs.length - 1], 'крайние точки не симметричны');
});

test('модель не обрезается на всём обороте', () => {
  const w = 360;
  const h = Math.round(w * 0.46);
  for (let deg = 0; deg < 360; deg += 2) {
    const p = projectShip(w, h, (deg * Math.PI) / 180);
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    assert.ok(Math.min(...xs) >= 0, `угол ${deg}°: левый край за холстом`);
    assert.ok(Math.max(...xs) <= w, `угол ${deg}°: правый край за холстом`);
    assert.ok(Math.min(...ys) >= 0, `угол ${deg}°: верх за холстом`);
    assert.ok(Math.max(...ys) <= h, `угол ${deg}°: низ за холстом`);
  }
});

test('модель занимает заметную часть ширины, а не треть', () => {
  // При первом масштабе корабль был шириной 146 px из 360 — мелко.
  const w = 360;
  const h = Math.round(w * 0.46);
  const p = projectShip(w, h, 0);
  const span = Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x));
  assert.ok(span > w * 0.7, `корабль занял ${span.toFixed(0)} px из ${w} — слишком мелко`);
  assert.ok(span <= w, `корабль шире холста: ${span.toFixed(0)} px`);
});

test('модель читается: силуэт выше нуля по обеим осям', () => {
  // Защита от вырожденной проекции, когда всё схлопывается в точку.
  const w = 360;
  const h = Math.round(w * 0.46);
  const p = projectShip(w, h, 0.7);
  const xs = p.map((q) => q.x);
  const ys = p.map((q) => q.y);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 100);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 30);
});

test('модель: дальние рёбра скрываются — корпус не просвечивает', () => {
  // Раньше рисовались все 38 рёбер одновременно, и корабль выглядел
  // проволочным клубком. Теперь дальние (обе вершины за серединой)
  // не рисуются.
  const w = 360;
  const h = Math.round(w * 0.46);
  const dist = 620;
  const scale = Math.min(w, h) * 0.0072;
  const pitch = 0.28;

  let minVisible = 99;
  let maxVisible = 0;
  for (let deg = 0; deg < 360; deg += 3) {
    const yaw = (deg * Math.PI) / 180;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const depth = V.map(([vx, vy, vz]) => {
      const z1 = -vx * sy + vz * cy;
      return vy * sp + z1 * cp;
    });
    const mid = (Math.min(...depth) + Math.max(...depth)) / 2;
    const visible = E.filter(([a, b]) => depth[a] < mid || depth[b] < mid).length;
    minVisible = Math.min(minVisible, visible);
    maxVisible = Math.max(maxVisible, visible);
  }
  assert.ok(maxVisible < E.length, 'на всех углах видно все рёбра — скрытия нет');
  assert.ok(minVisible >= 8, `на части углов видно всего ${minVisible} рёбер — силуэт теряется`);
  assert.ok(minVisible <= 20, 'скрытие слишком слабое');
});

/* ---------- Две карты: общая и местная ---------- */

const CHART_W = 255;
const CHART_H = 127.5;

/** Копия `overviewView` из main.ts. */
function overview(width: number) {
  const pad = 10;
  const height = Math.round(((width - 2 * pad) * CHART_H) / CHART_W + 2 * pad);
  const k = Math.min((width - 2 * pad) / CHART_W, (height - 2 * pad) / CHART_H);
  return {
    width,
    height,
    ratio: height / width,
    screenOf: (gx: number, gy: number) => ({
      x: width / 2 + (gx - CHART_W / 2) * k,
      y: height / 2 + (gy / 2 - CHART_H / 2) * k,
    }),
  };
}

/** Копия `localView` из main.ts. */
function local(width: number, fuel: number, here: { x: number; y: number }) {
  const pad = 10;
  const height = Math.min(width, 400);
  const radius = Math.max(3, (fuel / 4) * 1.15);
  const k = Math.min((width - 2 * pad) / (2 * radius), (height - 2 * pad) / (2 * radius));
  return {
    width,
    height,
    radius,
    screenOf: (gx: number, gy: number) => ({
      x: width / 2 + (gx - here.x) * k,
      y: height / 2 + (gy / 2 - here.y / 2) * k,
    }),
    visible: (s: { x: number; y: number }) =>
      Math.abs(s.x - here.x) <= radius && Math.abs(s.y / 2 - here.y / 2) <= radius,
  };
}

test('общая карта горизонтальная: высота около половины ширины', () => {
  // Галактика в карт-пространстве — 255 на 127.5, ровно 2:1.
  // Поворот на 90° был ошибкой: из-за него карта вытягивалась вниз
  // и переставала помещаться на экран.
  const v = overview(360);
  assert.ok(v.ratio < 0.7, `пропорции ${v.ratio.toFixed(2)} — карта не горизонтальная`);
  assert.ok(v.ratio > 0.45, 'карта слишком сплющена');
});

test('общая карта: вся галактика помещается в кадр', () => {
  const systems = buildGalaxy(1);
  const v = overview(360);
  for (const s of systems) {
    const p = v.screenOf(s.x, s.y);
    assert.ok(p.x >= 0 && p.x <= v.width, `${s.name}: X=${p.x.toFixed(0)} вне кадра`);
    assert.ok(p.y >= 0 && p.y <= v.height, `${s.name}: Y=${p.y.toFixed(0)} вне кадра`);
  }
});

test('местная карта: круг дальности круглый', () => {
  const v = local(360, 20, { x: 20, y: 173 });
  const R = 20 / 4;
  const cx = v.width / 2;
  const cy = v.height / 2;
  const pX = v.screenOf(20 + R, 173);
  const pY = v.screenOf(20, 173 + R * 2);
  const dX = Math.hypot(pX.x - cx, pX.y - cy);
  const dY = Math.hypot(pY.x - cx, pY.y - cy);
  assert.ok(Math.abs(dX - dY) < 0.5, `по X ${dX.toFixed(1)} px, по Y ${dY.toFixed(1)} px`);
});

test('местная карта: достижимые системы видны при любом топливе', () => {
  const systems = buildGalaxy(1);
  for (const here of systems) {
    for (const fuel of [10, 20, 40, 70]) {
      const v = local(360, fuel, here);
      for (const s of systems) {
        if (distance(here, s) > fuel) continue;
        assert.ok(v.visible(s), `${here.name} топливо ${fuel}: ${s.name} не видна`);
      }
    }
  }
});

/* ---------- Выбор системы на карте ---------- */

/**
 * Радиус попадания: не больше половины расстояния до ближайшей
 * соседней точки, но не меньше 10 px.
 *
 * Без этого правила палец, целясь в одну систему, накрывает соседнюю:
 * QUATOR и RA стоят в 19 px друг от друга, а радиус был 40.
 */
function tapTolerance(points: { x: number; y: number }[], target: number, base: number): number {
  let nearest = Infinity;
  for (let i = 0; i < points.length; i++) {
    if (i === target) continue;
    const d = Math.hypot(points[i].x - points[target].x, points[i].y - points[target].y);
    if (d < nearest) nearest = d;
  }
  const tol = nearest < Infinity ? Math.min(base, nearest / 2) : base;
  return Math.max(tol, 10);
}

test('карта: клик ровно в точку выбирает именно её', () => {
  // Реальные данные: LAVE и 11 соседей в окне при полном баке.
  const systems = buildGalaxy(1);
  const here = systems[7];
  const W = 360;
  const pad = 10;
  const radius = Math.max(3, (70 / 4) * 1.15);
  const k = Math.min((W - 2 * pad) / (2 * radius), (W - 2 * pad) / (2 * radius));

  const visible = systems.filter(
    (s) => Math.abs(s.x - here.x) <= radius && Math.abs(s.y / 2 - here.y / 2) <= radius,
  );
  const points = visible.map((s) => ({
    name: s.name,
    x: W / 2 + (s.x - here.x) * k,
    y: W / 2 + (s.y / 2 - here.y / 2) * k,
  }));

  for (let i = 0; i < points.length; i++) {
    // Ищем ближайшую к клику точку — ровно как в игре.
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < points.length; j++) {
      const d = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    const tol = tapTolerance(points, best, 34);
    assert.ok(bestD <= tol, `${points[i].name}: клик не попал (${bestD.toFixed(1)} > ${tol.toFixed(1)})`);
    assert.equal(best, i, `клик в ${points[i].name} выбрал ${points[best].name}`);
  }
});

test('карта: радиус попадания не даёт накрыть соседнюю систему', () => {
  // QUATOR и RA — 19 px. Старый радиус 40 выбирал не ту.
  const points = [
    { x: 129, y: 28 }, // радиус
    { x: 112, y: 20 }, // RA
  ];
  const tol = tapTolerance(points, 0, 34);
  assert.ok(tol <= 9.5 + 0.5, `радиус ${tol.toFixed(1)} px накрывает соседнюю точку в 19 px`);
  assert.ok(tol >= 10, 'радиус не должен быть меньше 10 px — иначе не попасть');
});
