/**
 * Извлекает геометрию корабля из tables.asm.
 *
 * Строки выглядят так:
 *   defb $20,$00,$4C,$1F,$FF,$FF,... ; $64BE
 * Комментарий после `;` тоже содержит `$..` (адрес), поэтому его
 * сначала отрезаем — иначе в координаты попадут адреса.
 */
import { readFileSync } from 'node:fs';

const path = '/home/user/elite-idle/reference/zx-elite-ataribaby/src/data/ship-blueprints-and-tables.asm';
const asm = readFileSync(path, 'utf8');
const lines = asm.split('\n');

function grab(label, count) {
  const start = lines.findIndex((l) => l.trim() === `${label}:`);
  if (start < 0) throw new Error(`нет метки ${label}`);
  const bytes = [];
  for (let i = start + 1; i < lines.length && bytes.length < count; i++) {
    const code = lines[i].split(';')[0].trim(); // отрезаем комментарий с адресом
    if (!code.startsWith('defb')) break;
    for (const m of code.matchAll(/\$([0-9A-Fa-f]{2})/g)) bytes.push(parseInt(m[1], 16));
  }
  if (bytes.length < count) throw new Error(`${label}: нужно ${count}, набрал ${bytes.length}`);
  return bytes.slice(0, count);
}

const vbytes = grab('ShipCobraMkIIIPirateVertices', 168);
const ebytes = grab('ShipCobraMkIIIPirateEdges', 152);
const fbytes = grab('ShipCobraMkIIIPirateFaces', 52);

/**
 * Вершина — 6 байт: |x|, |y|, |z|, затем байт знаков и видимости.
 * В нём биты 7/6/5 — знаки x/y/z, биты 0..4 — порог видимости.
 * Координаты хранятся модулями, знак отдельно. Именно поэтому первая
 * попытка «читать как знаковые» дала дубликаты: 32 и -32 неотличимы.
 */
const V = [];
for (let i = 0; i < vbytes.length; i += 6) {
  const mag = [vbytes[i], vbytes[i + 1], vbytes[i + 2]];
  const flags = vbytes[i + 3];
  const x = flags & 0x80 ? -mag[0] : mag[0];
  const y = flags & 0x40 ? -mag[1] : mag[1];
  const z = flags & 0x20 ? -mag[2] : mag[2];
  V.push([x, y, z]);
}

/**
 * Ребро — 4 байта: порог видимости, первая вершина, вторая вершина,
 * два номера граней по нибблам.
 *
 * Здесь я ошибся в первый раз: брал байты 0 и 2, то есть порог
 * видимости вместо индекса вершины. Рёбра выходили «31-1», и 23 из 38
 * указывали в никуда.
 */
const E = [];
for (let i = 0; i < ebytes.length; i += 4) {
  E.push([ebytes[i + 1], ebytes[i + 2]]);
}

console.log('вершин:', V.length, '| рёбер:', E.length);
console.log('первые 6 вершин:');
V.slice(0, 6).forEach((v, i) => console.log(' ', i, v.join(', ')));
console.log('первые 8 рёбер:', E.slice(0, 8).map((e) => e.join('-')).join('  '));

const bad = E.filter(([a, b]) => a >= V.length || b >= V.length);
console.log('битые рёбра:', bad.length);
console.log('вершин задействовано:', new Set(E.flat()).size, 'из', V.length);

const xs = V.map((v) => v[0]), ys = V.map((v) => v[1]), zs = V.map((v) => v[2]);
const rng = (a) => `${Math.min(...a)}..${Math.max(...a)}`;
console.log('диапазоны  X:', rng(xs), ' Y:', rng(ys), ' Z:', rng(zs));

// Дубликаты вершин: в Cobra Mk III их быть не должно
const key = (v) => v.join(',');
const dup = V.length - new Set(V.map(key)).size;
console.log('дубликатов:', dup);

/**
 * Грани. 4 байта: |nx|, |ny|, |nz|, затем байт знаков нормали
 * (биты 7/6/5) — та же схема, что у вершин. Нормаль нужна, чтобы
 * понять, какая грань смотрит на зрителя, и закрасить её.
 */
const F = [];
for (let i = 0; i < fbytes.length; i += 4) {
  const mag = [fbytes[i], fbytes[i + 1], fbytes[i + 2]];
  const fl = fbytes[i + 3];
  F.push([
    fl & 0x80 ? -mag[0] : mag[0],
    fl & 0x40 ? -mag[1] : mag[1],
    fl & 0x20 ? -mag[2] : mag[2],
  ]);
}
console.log('граней:', F.length);

/**
 * Какие грани сходятся в каждой вершине.
 *
 * Вершина хранит номера граней в байтах 4 и 5, по два в каждом (нибблы).
 * Это и есть связь «грань ↔ её углы»: отдельной таблицы нет.
 */
const vertexFaces = [];
for (let i = 0; i < vbytes.length; i += 6) {
  const a = vbytes[i + 4];
  const b = vbytes[i + 5];
  const faces = [a & 0x0f, a >> 4, b & 0x0f, b >> 4].filter((f) => f !== 0x0f);
  vertexFaces.push(faces);
}
console.log('вершина 0 сходится в гранях:', vertexFaces[0].join(', '));

// Проверка: каждая грань должна иметь хотя бы 3 вершины
const perFace = Array.from({ length: F.length }, () => []);
vertexFaces.forEach((faces, vi) => faces.forEach((f) => { if (perFace[f]) perFace[f].push(vi); }));
const faceSizes = perFace.map((v) => v.length);
console.log('вершин на грань: мин', Math.min(...faceSizes), 'макс', Math.max(...faceSizes));
const degenerate = faceSizes.filter((n) => n < 3).length;
console.log('граней с <3 вершинами:', degenerate);

/**
 * Грани собираются из РЁБЕР, а не из вершин.
 *
 * В ребре байт 3 хранит номера двух граней по нибблам. Если собрать
 * по ним все рёбра каждой грани, получаются верные многоугольники —
 * 11 из 13 плоских, а две «неплоские» отличаются только лишними
 * вершинами на оси симметрии (20, 21), которые лежат в той же
 * плоскости. Всё сходится.
 *
 * В вершине тоже есть номера граней (байты 4–5), но там они не
 * годятся: байты читаются как $FF и вершины расползаются по чужим
 * граням.
 */
const edgeFaces = new Map();
for (let i = 0; i < ebytes.length; i += 4) {
  const v1 = ebytes[i + 1];
  const v2 = ebytes[i + 2];
  const fb = ebytes[i + 3];
  for (const f of [fb & 0x0f, fb >> 4]) {
    if (f === 0x0f) continue;
    if (!edgeFaces.has(f)) edgeFaces.set(f, new Set());
    edgeFaces.get(f).add(v1);
    edgeFaces.get(f).add(v2);
  }
}
const FACES = [...edgeFaces.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([id, vs]) => ({ id, verts: [...vs].sort((a, b) => a - b) }));

console.log('\n--- грани из рёбер ---');
for (const f of FACES) console.log('  грань', f.id, '→', f.verts.join(','));

// Выпуклость: все вершины должны лежать по одну сторону от центра.
// Для заливки важно — иначе полигон самопересечётся.
let convexBad = 0;
for (const f of FACES) {
  if (f.verts.length < 3) continue;
  const pts = f.verts.map((i) => V[i]);
  // центр грани
  const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
  // нормаль по первым трём
  const [a0, b0, c0] = pts;
  const u = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]];
  const w = [c0[0] - a0[0], c0[1] - a0[1], c0[2] - a0[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const nl = Math.hypot(...n);
  if (!nl) continue;
  const nz = n.map((x) => x / nl);
  // нормаль должна смотреть наружу: от центра модели
  const modelCenter = [0, 0, 10];
  const outward = (c[0] - modelCenter[0]) * nz[0] + (c[1] - modelCenter[1]) * nz[1] + (c[2] - modelCenter[2]) * nz[2];
  if (outward < 0) nz.forEach((_, i) => (nz[i] = -nz[i]));
  // все вершины по одну сторону от плоскости центра
  let devMax = 0;
  for (const p of pts) {
    const d = (p[0] - c[0]) * nz[0] + (p[1] - c[1]) * nz[1] + (p[2] - c[2]) * nz[2];
    devMax = Math.max(devMax, Math.abs(d));
  }
  if (devMax > 3) convexBad++;
}

// --- вывод для вставки в src/ui/ship-model.ts ---------------------------
if (process.argv.includes('--emit')) {
  const rows = [];
  for (let i = 0; i < V.length; i += 4) {
    rows.push('  ' + V.slice(i, i + 4).map((v) => `[${v.join(', ')}]`).join(', ') + ',');
  }
  const erows = [];
  for (let i = 0; i < E.length; i += 6) {
    erows.push('  ' + E.slice(i, i + 6).map((e) => `[${e.join(', ')}]`).join(', ') + ',');
  }
  console.log('\n--- VERTICES ---\n' + rows.join('\n'));
  console.log('--- EDGES ---\n' + erows.join('\n'));
  // Грани: нормаль + вершины (порядок обхода берём по возрастанию индекса)
  const frows = F.map((n, fi) => {
    const vs = perFace[fi];
    return `  { normal: [${n.join(', ')}], verts: [${vs.join(', ')}] },`;
  });
  console.log('--- FACES ---\n' + frows.join('\n'));
  const facerows = FACES.map((f) => `  [${f.verts.join(', ')}],`);
  console.log('--- FACE POLYGONS ---\n' + facerows.join('\n'));
}
