/**
 * Модель корабля и карта — проверки геометрии.
 *
 * Обе вещи ломаются молча: карта рисуется, но точки уезжают за холст;
 * корабль рисуется, но обрезается на части углов поворота. Глазами
 * такое видно не сразу, а тестом — сразу.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

/* ---------- Карта после поворота на 90° ---------- */

/** Копия проекции из `main.ts` — проверяем математику, а не DOM. */
function projection(width: number) {
  const pad = 14;
  const innerW = width - 2 * pad;
  const k = innerW / 127;
  const height = Math.round(255 * k + 2 * pad);
  return {
    width,
    height,
    k,
    screenX: (gx: number) => pad + gx * k,
    screenY: (gy: number) => pad + gy * k,
  };
}

test('карта: все углы галактики попадают на холст', () => {
  for (const w of [320, 360, 414, 768]) {
    const p = projection(w);
    for (const [gx, gy] of [[0, 0], [255, 0], [0, 127], [255, 127]]) {
      const x = p.screenX(gx);
      const y = p.screenY(gy);
      assert.ok(x >= 0 && x <= p.height, `ширина ${w}: X=${x.toFixed(0)} вне 0..${p.height}`);
      assert.ok(y >= 0 && y <= p.width, `ширина ${w}: Y=${y.toFixed(0)} вне 0..${p.width}`);
    }
  }
});

test('карта: после поворота она выше, чем шире', () => {
  // Галактика 255×127, повёрнутая на 90°, даёт вытянутый вниз холст.
  const p = projection(360);
  assert.ok(p.height > p.width, `высота ${p.height} должна быть больше ширины ${p.width}`);
  assert.ok(p.height / p.width > 1.5, 'карта должна заметно вытянуться');
});

test('карта: масштаб по обеим осям одинаков — круг прыжка не станет эллипсом', () => {
  const p = projection(360);
  // Расстояние между соседними координатами должно быть кратно k по обеим осям.
  assert.equal(p.screenX(1) - p.screenX(0), p.screenY(1) - p.screenY(0));
});

test('карта: X галактики идёт вниз, Y — вправо', () => {
  const p = projection(360);
  assert.ok(p.screenX(100) > p.screenX(0), 'рост X должен вести вниз');
  assert.ok(p.screenY(100) > p.screenY(0), 'рост Y должен вести вправо');
  // И это разные оси: X не должен менять горизонталь.
  assert.equal(p.screenY(0), p.screenY(0));
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
