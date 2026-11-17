/**
 * Рендерит ВСЕ корабли парка тем же кодом, что игра, в один PNG.
 *
 * Зачем: у 12 из 13 моделей никогда не было визуальной проверки —
 * только данные из исходников. Сломанный контур грани, вывернутая
 * нормаль или переполнение кадра видны исключительно глазом (§69).
 *
 * Берёт данные прямо из src/ui/ship-model.ts, чтобы картинка не
 * разошлась с игрой. Растеризатор тот же, что в render-ship.mjs.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { FLEET } from '../src/ui/ship-model.ts';

const CELL_W = 260, CELL_H = 180;
const PITCH = 0.28, DIST = 620;
const IDS = ['sidewinder','gecko','adder','cobra1','mamba','krait','moray','cobra3','asp','ferdelance','python','anaconda','viper'];
const COLS = 4;
const ROWS = Math.ceil(IDS.length / COLS);
const W = CELL_W * COLS, H = CELL_H * ROWS;

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

function fillPoly(buf, ox, oy, poly, col) {
  const ys = poly.map((p) => p.y);
  const y0 = Math.max(oy, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(ox, Math.round(xs[i])); x <= Math.min(ox + CELL_W - 1, Math.round(xs[i + 1])); x++) {
        const j = (y * W + x) * 3; buf[j] = col[0]; buf[j+1] = col[1]; buf[j+2] = col[2];
      }
    }
  }
}

function line(buf, x0, y0, x1, y1, col) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= n; s++) {
    const x = Math.round(x0 + (x1 - x0) * s / n), y = Math.round(y0 + (y1 - y0) * s / n);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const j = (y * W + x) * 3; buf[j] = col[0]; buf[j+1] = col[1]; buf[j+2] = col[2];
  }
}

const buf = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) { buf[i*3] = 11; buf[i*3+1] = 20; buf[i*3+2] = 18; }

IDS.forEach((id, idx) => {
  const bp = FLEET[id];
  const ox = (idx % COLS) * CELL_W, oy = Math.floor(idx / COLS) * CELL_H;
  // Центр габарита — как в drawShipModel.
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const v of bp.verts) {
    mnx = Math.min(mnx, v[0]); mxx = Math.max(mxx, v[0]);
    mny = Math.min(mny, v[1]); mxy = Math.max(mxy, v[1]);
    mnz = Math.min(mnz, v[2]); mxz = Math.max(mxz, v[2]);
  }
  const c = [(mnx+mxx)/2, (mny+mxy)/2, (mnz+mxz)/2];
  const span = Math.max(mxx-mnx, mxy-mny, mxz-mnz) || 1;
  const yaw = 0.7; // три четверти: видно нос и борт
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  // Та же подгонка, что в drawShipModel: по размаху проекции.
  const rotated = bp.verts.map(([rx, ry, rz]) => {
    const vx = rx - c[0], vy = ry - c[1], vz = rz - c[2];
    const x1 = vx*cy + vz*sy, z1 = -vx*sy + vz*cy;
    const y2 = vy*cp - z1*sp, z2 = vy*sp + z1*cp;
    return { x: x1, y: y2, z: z2 };
  });
  let extX = 1e-6, extY = 1e-6;
  for (const r of rotated) {
    const k = DIST / (r.z + DIST);
    extX = Math.max(extX, Math.abs(r.x * k) * 2);
    extY = Math.max(extY, Math.abs(r.y * k) * 2);
  }
  const scale = Math.min((CELL_W * 0.92) / extX, (CELL_H * 0.86) / extY);
  const P = rotated.map((r) => {
    const k = (DIST / (r.z + DIST)) * scale;
    return { x: ox + CELL_W/2 + r.x*k, y: oy + CELL_H/2 + r.y*k, z: r.z };
  });

  const faceData = bp.faces.map((vs) => {
    const pts3 = vs.map((i) => bp.verts[i]);
    const cc = [0,0,0];
    for (const p of pts3) { cc[0]+=p[0]/pts3.length; cc[1]+=p[1]/pts3.length; cc[2]+=p[2]/pts3.length; }
    const [a,b,d] = pts3;
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], w = [d[0]-a[0], d[1]-a[1], d[2]-a[2]];
    let n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
    const nl = Math.hypot(...n) || 1; n = n.map((x) => x/nl);
    const out = (cc[0]-c[0])*n[0] + (cc[1]-c[1])*n[1] + (cc[2]-c[2])*n[2];
    if (out < 0) n = n.map((x) => -x);
    const x1 = n[0]*cy + n[2]*sy, z1 = -n[0]*sy + n[2]*cy;
    const y2 = n[1]*cp - z1*sp, z2 = n[1]*sp + z1*cp;
    const depth = vs.reduce((acc, i) => acc + P[i].z, 0) / vs.length;
    return { vs, n: { x: x1, y: y2, z: z2 }, depth };
  }).sort((p, q) => p.depth - q.depth);

  // силуэт
  fillPoly(buf, ox, oy, convexHull(P.map((p) => ({ x: p.x, y: p.y }))), [17, 46, 42]);

  const light = { x: -0.45, y: 0.75, z: 0.55 };
  const ll = Math.hypot(light.x, light.y, light.z);
  for (const f of faceData) {
    if (f.n.z < -0.05) continue;
    const lam = Math.max(0, (f.n.x*light.x + f.n.y*light.y + f.n.z*light.z)/ll);
    const shade = 0.55 + 0.45*lam;
    fillPoly(buf, ox, oy, convexHull(f.vs.map((i) => P[i])), [Math.round(26*shade), Math.round(74*shade), Math.round(68*shade)]);
  }

  const edgeFaces = new Map();
  for (const f of faceData) {
    for (const [a, b] of bp.edges) {
      if (!f.vs.includes(a) || !f.vs.includes(b)) continue;
      const key = Math.min(a,b) + '-' + Math.max(a,b);
      if (!edgeFaces.has(key)) edgeFaces.set(key, []);
      edgeFaces.get(key).push(f.n.z);
    }
  }
  for (const [key, nzs] of edgeFaces) {
    const front = nzs.filter((z) => z > 0.02).length;
    const back = nzs.filter((z) => z < -0.02).length;
    if (!(front > 0 && back > 0)) continue;
    const [a, b] = key.split('-').map(Number);
    line(buf, P[a].x, P[a].y, P[b].x, P[b].y, [79, 216, 196]);
  }

  console.log(id.padEnd(12), bp.name.padEnd(13), 'верш', String(bp.verts.length).padStart(2), 'граней', String(bp.faces.length).padStart(2), 'span', span);
});

function crc32(b) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
const raw = Buffer.alloc((W*3+1)*H);
for (let y = 0; y < H; y++) Buffer.from(buf.buffer, y*W*3, W*3).copy(raw, y*(W*3+1)+1);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2;
const png = Buffer.concat([
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync('/home/user/elite-idle/preview-fleet.png', png);
console.log('\npreview-fleet.png', W + '×' + H);
