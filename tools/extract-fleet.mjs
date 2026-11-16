/**
 * Извлекает геометрию всех встречающихся кораблей из исходников
 * Mark Moxon (BBC Micro disc), в формате VERTEX/EDGE/FACE.
 *
 * Зачем свой извлекатель, а не `extract-ship.mjs`: тот читает готовые
 * байты ZX-версии, где геометрия свёрнута в defb-потоки. Здесь исходник
 * уже человеческий — макросы с числами в десятичном виде.
 *
 * Формат (elite.bbcelite.com, Drawing ships):
 *   VERTEX x, y, z, face1, face2, face3, face4, visibility
 *   EDGE   v1, v2, face1, face2, visibility
 *   FACE   nx, ny, nz, visibility
 *
 * Координаты со знаком — в отличие от ZX-версии, где знак лежал
 * отдельными битами, поэтому дубликатов 32/−32 тут не будет.
 *
 * Контуры граней строятся по рёбрам: в ребре записаны две грани, и
 * вершины всех его рёбер дают контур. Тот же приём, что в §69.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

/*
 * Откуда берутся исходники.
 *
 * В этом репозитории ZX-версия лежит в `reference/`, но в ней только
 * 8 кораблей из 13 (Gecko, Mamba, Moray, Adder, Cobra Mk I, Anaconda
 * в этой сборке не выводятся). Поэтому парк берётся из BBC-исходников
 * Mark Moxon, а они клонируются отдельно — в репозиторий они не входят
 * (см. .gitignore: reference/).
 *
 * Клонировать так:
 *   git clone --depth 1 --filter=blob:none --sparse \
 *     https://github.com/markmoxon/elite-source-code-bbc-micro-disc.git /tmp/elite-src
 *   cd /tmp/elite-src && git sparse-checkout set 1-source-files/main-sources
 */
const DIR = process.env.ELITE_SRC ?? '/tmp/elite-src/1-source-files/main-sources';
if (!existsSync(DIR)) {
  console.error(`Нет исходников: ${DIR}`);
  console.error('Склонируйте их (команда в шапке файла) или задайте ELITE_SRC.');
  process.exit(1);
}
const SHIPS = [
  'SIDEWINDER', 'GECKO', 'ADDER', 'COBRA_MK_1', 'MAMBA', 'KRAIT', 'MORAY',
  'COBRA_MK_3', 'ASP_MK_2', 'FER_DE_LANCE', 'PYTHON', 'ANACONDA', 'VIPER',
];

function section(asm, label) {
  const start = asm.indexOf('.SHIP_' + label + '_VERTICES');
  if (start < 0) return null;
  const rest = asm.slice(start);
  const verts = [], edges = [], faces = [];
  let inFaces = false;
  for (const line of rest.split('\n')) {
    const body = line.split('\\')[0].trim();
    if (!body) continue;
    const m = body.match(/^(VERTEX|EDGE|FACE)\s+(.+)$/);
    if (!m) {
      if (verts.length && edges.length && (inFaces || body.startsWith('.SHIP_'))) break;
      continue;
    }
    if (m[1] === 'FACE') inFaces = true;
    const nums = m[2].split(',').map((x) => Number(x.trim()));
    if (m[1] === 'VERTEX') verts.push([nums[0], nums[1], nums[2]]);
    else if (m[1] === 'EDGE') edges.push({ v: [nums[0], nums[1]], f: [nums[2], nums[3]] });
    else faces.push([nums[0], nums[1], nums[2]]);
  }
  return { verts, edges, faces };
}

function polygons(sec) {
  const per = new Map();
  for (const e of sec.edges) {
    for (const f of e.f) {
      if (f === 0x0f || f < 0) continue;
      if (!per.has(f)) per.set(f, new Set());
      per.get(f).add(e.v[0]);
      per.get(f).add(e.v[1]);
    }
  }
  return [...per.entries()].sort((a, b) => a[0] - b[0]).map(([, vs]) => [...vs].sort((a, b) => a - b));
}

const out = {};
for (const file of readdirSync(DIR).filter((f) => /^elite-ships-[a-z]\.asm$/.test(f))) {
  const asm = readFileSync(DIR + '/' + file, 'utf8');
  for (const id of SHIPS) {
    if (out[id]) continue;
    const sec = section(asm, id);
    if (!sec || sec.verts.length < 4 || sec.edges.length < 6) continue;
    const polys = polygons(sec).filter((p) => p.length >= 3);
    const maxIdx = Math.max(...sec.edges.flatMap((e) => e.v));
    if (maxIdx >= sec.verts.length) continue;
    out[id] = { verts: sec.verts, edges: sec.edges.map((e) => e.v), polys, source: file };
    console.log(
      id.padEnd(12) + ' вершин ' + String(sec.verts.length).padStart(2) +
      ' · рёбер ' + String(sec.edges.length).padStart(2) +
      ' · граней ' + String(polys.length).padStart(2) + '  (' + file + ')',
    );
  }
}

const missing = SHIPS.filter((s) => !out[s]);
if (missing.length) console.log('НЕ НАЙДЕНЫ: ' + missing.join(', '));
writeFileSync('/tmp/fleet.json', JSON.stringify(out));
console.log('\nзаписано /tmp/fleet.json, кораблей: ' + Object.keys(out).length);
