/**
 * Рендерит модель корабля ТЕМ ЖЕ кодом, что и игра, в PNG.
 *
 * Зачем: «прозрачность» и «не хватает граней» — то, что видно только
 * глазом. Тесты проверяют числа, но не то, как это выглядит. Здесь
 * минимальный растеризатор (заливка полигонов + обводка) и запись PNG
 * через zlib — без зависимостей.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const V = [
  [32,0,76],[-32,0,76],[0,26,24],[-120,-3,-8],[120,-3,-8],[-88,16,-40],[88,16,-40],[128,-8,-40],
  [-128,-8,-40],[0,26,-40],[-32,-24,-40],[32,-24,-40],[-36,8,-40],[-8,12,-40],[8,12,-40],[36,8,-40],
  [36,-12,-40],[8,-16,-40],[-8,-16,-40],[-36,-12,-40],[0,0,76],[0,0,90],[-80,-6,-40],[-80,6,-40],
  [-88,0,-40],[80,6,-40],[88,0,-40],[80,-6,-40],
];
const F = [
  [0,1,2,20,21],[1,2,5],[0,2,6],[1,3,5],[0,4,6],[2,5,9],[2,6,9],[3,5,8],[4,6,7],
  [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,22,23,24,25,26,27],
  [1,3,8,10],[0,1,10,11,20,21],[0,4,7,11],
];

const EDGES = [
  [0,1],[0,4],[1,3],[3,8],[4,7],[6,7],[6,9],[5,9],[5,8],[2,5],[2,6],[3,5],[4,6],[1,2],[0,2],
  [8,10],[10,11],[7,11],[1,10],[0,11],[1,5],[0,6],[20,21],[12,13],[18,19],[14,15],[16,17],
  [15,16],[14,17],[13,18],[12,19],[2,9],[22,24],[23,24],[22,23],[25,26],[26,27],[25,27],
];

const W = 480, H = 240, PITCH = 0.28, DIST = 620, SCALE = Math.min(W, H) * 0.0072;

/** Выпуклая оболочка — как в ship-model.ts. */
function convexHull(points) {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

function render(yaw) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  const P = V.map(([vx, vy, vz]) => {
    const x1 = vx * cy + vz * sy, z1 = -vx * sy + vz * cy;
    const y2 = vy * cp - z1 * sp, z2 = vy * sp + z1 * cp;
    const k = (DIST / (z2 + DIST)) * SCALE;
    return { x: W / 2 + x1 * k, y: H / 2 + y2 * k, z: z2 };
  });

  const faces = F.map((vs) => {
    const [a, b, c] = vs.slice(0, 3).map((i) => V[i]);
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], w = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    let n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
    const nl = Math.hypot(...n) || 1; n = n.map((x) => x/nl);
    const x1 = n[0]*cy + n[2]*sy, z1 = -n[0]*sy + n[2]*cy;
    const y2 = n[1]*cp - z1*sp, z2 = n[1]*sp + z1*cp;
    const c3 = [0,0,0];
    for (const i of vs) { c3[0]+=V[i][0]/vs.length; c3[1]+=V[i][1]/vs.length; c3[2]+=V[i][2]/vs.length; }
    const out = c3[0]*n[0] + c3[1]*n[1] + (c3[2]-10)*n[2];
    const nz = out < 0 ? -z2 : z2;
    const depth = vs.reduce((acc, i) => acc + P[i].z, 0) / vs.length;
    return { vs, n: { x: x1, y: y2, z: nz }, depth };
  }).sort((p, q) => p.depth - q.depth);

  return { P, faces };
}

// Простой растеризатор
function rasterize(yaw) {
  const buf = new Uint8Array(W * H * 3);
  // фон
  for (let i = 0; i < W * H; i++) { buf[i*3]=11; buf[i*3+1]=20; buf[i*3+2]=18; }
  const { P, faces } = render(yaw);
  const light = { x: -0.45, y: 0.75, z: 0.55 };
  const ll = Math.hypot(light.x, light.y, light.z);

  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3; buf[i]=r; buf[i+1]=g; buf[i+2]=b;
  };
  const line = (x0, y0, x1, y1, r, g, b) => {
    const dx = Math.abs(x1-x0), dy = Math.abs(y1-y0), n = Math.max(dx, dy, 1);
    for (let s = 0; s <= n; s++) put(Math.round(x0+(x1-x0)*s/n), Math.round(y0+(y1-y0)*s/n), r, g, b);
  };

  // ШАГ 1: силуэт целиком — гарантия непрозрачности
  const sil = convexHull(P.map((p) => ({ x: p.x, y: p.y })));
  for (let y = 0; y < H; y++) {
    const xs = [];
    for (let i = 0; i < sil.length; i++) {
      const a = sil[i], b = sil[(i + 1) % sil.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(0, Math.round(xs[i])); x <= Math.min(W - 1, Math.round(xs[i + 1])); x++) put(x, y, 17, 46, 42);
    }
  }

  for (const f of faces) {
    if (f.n.z < -0.05) continue;
    const facing = true;
    const lam = Math.max(0, (f.n.x*light.x + f.n.y*light.y + f.n.z*light.z)/ll);
    const shade = 0.55 + 0.45*lam;
    const col = [Math.round(26*shade), Math.round(74*shade), Math.round(68*shade)];

    // заливка по выпуклой оболочке — внутренние вершины давали дыры
    const pts = f.vs.map((i) => P[i]);
    const sorted = convexHull(pts);

    // сканлайн-заливка
    const ys = sorted.map(p=>p.y);
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H-1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const xs = [];
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i], b = sorted[(i+1)%sorted.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          xs.push(a.x + (y-a.y)/(b.y-a.y)*(b.x-a.x));
        }
      }
      xs.sort((p,q)=>p-q);
      for (let i = 0; i+1 < xs.length; i += 2) {
        for (let x = Math.max(0,Math.round(xs[i])); x <= Math.min(W-1,Math.round(xs[i+1])); x++) put(x,y,...col);
      }
    }

  }

  // только силуэтные рёбра: одна грань к зрителю, другая — нет
  const edgeFaces = new Map();
  for (const f of faces) {
    for (const [a, b] of EDGES) {
      if (!f.vs.includes(a) || !f.vs.includes(b)) continue;
      const key = `${Math.min(a,b)}-${Math.max(a,b)}`;
      if (!edgeFaces.has(key)) edgeFaces.set(key, []);
      edgeFaces.get(key).push(f.n.z);
    }
  }
  for (const [key, nzs] of edgeFaces) {
    const front = nzs.filter((z) => z > 0.02).length;
    const back = nzs.filter((z) => z < -0.02).length;
    if (!(front > 0 && back > 0)) continue;
    const [a, b] = key.split('-').map(Number);
    line(Math.round(P[a].x), Math.round(P[a].y), Math.round(P[b].x), Math.round(P[b].y), 79, 216, 196);
  }
  return buf;
}

// --- PNG без зависимостей ---
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
function png(pixels, w, h) {
  const raw = Buffer.alloc((w*3+1)*h);
  for (let y = 0; y < h; y++) {
    raw[y*(w*3+1)] = 0;
    Buffer.from(pixels.buffer, y*w*3, w*3).copy(raw, y*(w*3+1)+1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4);
  ihdr[8]=8; ihdr[9]=2; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Собираем сетку из 4 углов
const angles = [0, Math.PI/4, Math.PI/2, (3*Math.PI)/4];
const CW = W, CH = H;
const sheet = new Uint8Array(CW*2 * CH*2 * 3);
angles.forEach((a, idx) => {
  const img = rasterize(a);
  const ox = (idx % 2) * CW, oy = Math.floor(idx / 2) * CH;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const si = (y*CW+x)*3, di = ((y+oy)*(CW*2)+(x+ox))*3;
    sheet[di]=img[si]; sheet[di+1]=img[si+1]; sheet[di+2]=img[si+2];
  }
});
writeFileSync('/home/user/elite-idle/preview-ship.png', png(sheet, CW*2, CH*2));
console.log('✅ preview-ship.png —', CW*2, 'x', CH*2, '(4 угла поворота)');
