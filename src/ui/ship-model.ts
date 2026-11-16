/**
 * Вращающаяся модель корабля игрока — Cobra Mk III.
 *
 * Геометрия **не нарисована на глаз**, а извлечена из оригинала:
 * `ShipCobraMkIIIPirateVertices` / `ShipCobraMkIIIPirateEdges` в
 * `src/data/ship-blueprints-and-tables.asm` (адреса `$64BE` и `$6566`).
 * Пересчитать можно командой `node tools/extract-ship.mjs --emit`.
 *
 * Формат оригинала, который пришлось разобрать:
 *  - вершина — 6 байт: |x|, |y|, |z|, затем байт знаков;
 *    координаты хранятся **модулями**, знак лежит отдельными битами
 *    7/6/5. Чтение «как знаковых» даёт дубликаты: 32 и −32 неотличимы;
 *  - ребро — 4 байта: порог видимости, первая вершина, вторая вершина,
 *    номера граней по нибблам.
 *
 * Почему проекция своя, а не `rotate` из оригинала: у ZX Elite всё
 * целочисленное, ради экономии. Здесь разрешено все — это canvas,
 * а не 8-битная машина, поэтому математика обычная, в числах с плавающей точкой.
 */

/** Вершины: x влево-вправо, y вверх-вниз, z вдоль корпуса. */
const VERTICES: readonly (readonly [number, number, number])[] = [
  [32, 0, 76], [-32, 0, 76], [0, 26, 24], [-120, -3, -8],
  [120, -3, -8], [-88, 16, -40], [88, 16, -40], [128, -8, -40],
  [-128, -8, -40], [0, 26, -40], [-32, -24, -40], [32, -24, -40],
  [-36, 8, -40], [-8, 12, -40], [8, 12, -40], [36, 8, -40],
  [36, -12, -40], [8, -16, -40], [-8, -16, -40], [-36, -12, -40],
  [0, 0, 76], [0, 0, 90], [-80, -6, -40], [-80, 6, -40],
  [-88, 0, -40], [80, 6, -40], [88, 0, -40], [80, -6, -40],
];

/** Рёбра: пары индексов вершин. */
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [0, 4], [1, 3], [3, 8], [4, 7], [6, 7],
  [6, 9], [5, 9], [5, 8], [2, 5], [2, 6], [3, 5],
  [4, 6], [1, 2], [0, 2], [8, 10], [10, 11], [7, 11],
  [1, 10], [0, 11], [1, 5], [0, 6], [20, 21], [12, 13],
  [18, 19], [14, 15], [16, 17], [15, 16], [14, 17], [13, 18],
  [12, 19], [2, 9], [22, 24], [23, 24], [22, 23], [25, 26],
  [26, 27], [25, 27],
];

export interface ShipModelOptions {
  /** Размер холста в CSS-пикселях. */
  width: number;
  height: number;
  /** Угол поворота вокруг вертикальной оси, радианы. */
  yaw: number;
  /** Угол наклона, радианы. Небольшой, чтобы читался силуэт сверху. */
  pitch?: number;
  /** Цвет линий. */
  stroke?: string;
  /** Цвет «носа» — чтобы было видно, куда корабль смотрит. */
  accent?: string;
}

/**
 * Рисует корабль в перспективе.
 *
 * Простая перспектива: чем дальше точка, тем ближе к центру. Без неё
 * рёбра дальней стороны наезжают на ближние и силуэт читается хуже.
 */
export function drawShipModel(ctx: CanvasRenderingContext2D, o: ShipModelOptions): void {
  const { width, height, yaw } = o;
  const pitch = o.pitch ?? 0.28;
  const stroke = o.stroke ?? '#4fd8c4';
  const accent = o.accent ?? '#ffd37a';

  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);

  // Масштаб: модель 256 единиц в поперечнике. Берём высоту холста как
  // опору — она меньше ширины, и модель не обрежется при вращении,
  // когда размах максимален (носовые «крылья» у Cobra).
  // Коэффициент подобран так, чтобы корабль занимал ~85% ШИРИНЫ:
  // при 0.0032 он выходил третью часть, и это выглядело мелко.
  const scale = Math.min(width, height) * 0.0072;
  const dist = 620; // «расстояние до камеры» в единицах модели
  const cx = width / 2;
  const cyy = height / 2;

  type Projected = { x: number; y: number; depth: number };
  const projected: Projected[] = [];

  for (const [vx, vy, vz] of VERTICES) {
    // поворот вокруг вертикали (Y), затем наклон (X)
    const x1 = vx * cy + vz * sy;
    const z1 = -vx * sy + vz * cy;
    const y2 = vy * cp - z1 * sp;
    const z2 = vy * sp + z1 * cp;

    const depth = z2 + dist;
    const k = (dist / depth) * scale;
    projected.push({ x: cx + x1 * k, y: cyy + y2 * k, depth: z2 });
  }

  // Дальние рёбра рисуем первыми и бледнее — так силуэт читается объёмно.
  const lines = EDGES.map(([a, b]) => ({
    a: projected[a],
    b: projected[b],
    depth: (projected[a].depth + projected[b].depth) / 2,
  })).sort((p, q) => p.depth - q.depth);

  const far = stroke + '55';
  ctx.lineWidth = 1.15;
  ctx.lineJoin = 'round';
  for (const l of lines) {
    // Светимость по глубине: ближние ярче.
    const near = l.depth > 0;
    ctx.strokeStyle = near ? stroke : far;
    ctx.beginPath();
    ctx.moveTo(l.a.x, l.a.y);
    ctx.lineTo(l.b.x, l.b.y);
    ctx.stroke();
  }

  // Нос: две передние вершины (0 и 21 — кончик). Отмечаем точкой, чтобы
  // было видно направление вращения.
  const nose = projected[21];
  const nose2 = projected[20];
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(nose.x, nose.y, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(nose2.x, nose2.y, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

/** Сколько пикселей отступать от краёв, чтобы модель не липла. */
export const SHIP_MODEL_SIZE = { ratio: 0.62 };
