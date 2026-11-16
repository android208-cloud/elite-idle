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
}
