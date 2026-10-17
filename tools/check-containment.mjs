// Reports, for every mesh in public/assets/*.glb, the fraction of its vertices that lie
// outside the skin mesh (body.glb). Point-in-mesh by ray parity against the skin triangles.
//   node tools/check-containment.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(here, '../public/assets');

function readGlb(path) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12); const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  const binStart = 20 + jsonLen + 8; const bin = buf.subarray(binStart);
  const acc = i => { const a = json.accessors[i], v = json.bufferViews[a.bufferView]; const off = (v.byteOffset || 0); const n = a.count * (a.type === 'VEC3' ? 3 : 1);
    return a.componentType === 5126 ? new Float32Array(bin.buffer, bin.byteOffset + off, n) : new Uint32Array(bin.buffer, bin.byteOffset + off, n); };
  return json.meshes.map(m => ({ name: m.name, pos: acc(m.primitives[0].attributes.POSITION), idx: acc(m.primitives[0].indices) }));
}

const skin = readGlb(resolve(DIR, 'body.glb')).find(m => m.name === 'skin');
if (!skin) { console.error('no body.glb skin'); process.exit(1); }
// Bucket skin triangles by y and z for +x ray tests.
const CELL = 1.5; const grid = new Map();
const key = (j, k) => j * 100000 + k;
const tri = skin.idx.length / 3;
for (let t = 0; t < tri; t++) {
  const a = skin.idx[t * 3] * 3, b = skin.idx[t * 3 + 1] * 3, c = skin.idx[t * 3 + 2] * 3;
  const ys = [skin.pos[a + 1], skin.pos[b + 1], skin.pos[c + 1]], zs = [skin.pos[a + 2], skin.pos[b + 2], skin.pos[c + 2]];
  const j0 = Math.floor(Math.min(...ys) / CELL), j1 = Math.floor(Math.max(...ys) / CELL), k0 = Math.floor(Math.min(...zs) / CELL), k1 = Math.floor(Math.max(...zs) / CELL);
  for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) { const kk = key(j, k); let l = grid.get(kk); if (!l) { l = []; grid.set(kk, l); } l.push(t); }
}
function inside(x, y, z) {
  const list = grid.get(key(Math.floor(y / CELL), Math.floor(z / CELL))); if (!list) return false;
  let crossings = 0;
  for (const t of list) {
    const a = skin.idx[t * 3] * 3, b = skin.idx[t * 3 + 1] * 3, c = skin.idx[t * 3 + 2] * 3;
    // Ray +x from (x,y,z): intersect with triangle projected on yz, then check x of the hit.
    const ay = skin.pos[a + 1] - y, az = skin.pos[a + 2] - z, by = skin.pos[b + 1] - y, bz = skin.pos[b + 2] - z, cy = skin.pos[c + 1] - y, cz = skin.pos[c + 2] - z;
    const d1 = ay * bz - az * by, d2 = by * cz - bz * cy, d3 = cy * az - cz * ay;
    if (!((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0))) continue;
    const area = d1 + d2 + d3; if (Math.abs(area) < 1e-12) continue;
    const w1 = d2 / area, w2 = d3 / area, w3 = d1 / area; // barycentric for a, b, c
    const hx = w1 * skin.pos[a] + w2 * skin.pos[b] + w3 * skin.pos[c];
    if (hx > x) crossings++;
  }
  return (crossings & 1) === 1;
}

const rows = [];
for (const f of readdirSync(DIR).filter(f => f.endsWith('.glb') && f !== 'body.glb')) {
  for (const m of readGlb(resolve(DIR, f))) {
    const n = m.pos.length / 3; const step = Math.max(1, Math.floor(n / 400)); let out = 0, tot = 0; let maxDepth = 0;
    for (let i = 0; i < n; i += step) { tot++; const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2]; if (!inside(x, y, z)) { out++; let dm = Infinity; for (let s = 0; s < skin.pos.length; s += 9) { const dd = Math.hypot(skin.pos[s] - x, skin.pos[s + 1] - y, skin.pos[s + 2] - z); if (dd < dm) dm = dd; } maxDepth = Math.max(maxDepth, dm); } }
    rows.push({ file: f.replace('.glb', ''), id: m.name, outside: out / tot, n, maxDepth });
  }
}
rows.sort((a, b) => b.outside - a.outside);
console.log('structure                     outside   verts');
for (const r of rows) console.log(`${(r.file + '/' + r.id).padEnd(30)} ${(100 * r.outside).toFixed(0).padStart(5)}%   ${String(r.n).padStart(6)}   max ${r.maxDepth.toFixed(1)} units out`);
