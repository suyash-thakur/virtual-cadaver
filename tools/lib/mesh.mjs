// Shared mesh tooling for the asset converters: OBJ parsing, the BodyParts3D frame change,
// arm pose skinning, normals, clipping and a minimal GLB writer.
import { readFileSync, writeFileSync } from 'node:fs';

/** Fit: humeral head centre in our world, and the direction the humerus points (world). */
export const HEAD_WORLD = [-16.306, 0.557, -1.6];
export const ARM_DIR_WORLD = [-0.643, -0.766, 0];
export const OUR_HUMERUS_LENGTH = 29.4;

export function parseObj(path) {
  const pos = [], idx = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('v ')) { const p = line.split(/\s+/); pos.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('f ')) {
      const f = line.trim().split(/\s+/).slice(1).map(t => parseInt(t.split('/')[0], 10) - 1);
      for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]);
    }
  }
  return { pos, idx };
}
export function merge(parts) {
  const pos = [], idx = [];
  for (const p of parts) { const off = pos.length / 3; for (const v of p.pos) pos.push(v); for (const i of p.idx) idx.push(i + off); }
  return { pos, idx };
}
/** Multiplies every coordinate (e.g. metres → millimetres). */
export function scaleMesh(mesh, s) { return { pos: mesh.pos.map(v => v * s), idx: mesh.idx }; }

export function quatFromTo(a, b) {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const w = 1 + d; const n = Math.hypot(c[0], c[1], c[2], w);
  return [c[0] / n, c[1] / n, c[2] / n, w / n];
}
export function slerpId(q, t) {
  const ang = 2 * Math.acos(Math.min(1, q[3])); if (ang < 1e-6) return [0, 0, 0, 1];
  const s = Math.sin(ang / 2); const ax = [q[0] / s, q[1] / s, q[2] / s]; const h = ang * t / 2;
  return [ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h), Math.cos(h)];
}
export function rotate(q, v) {
  const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
export const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Frame from a humerus in the BodyParts3D convention (mm; x patient-left, y posterior, z superior):
 * scale so the humerus has our length, map axes to our world and put the humeral head at HEAD_WORLD.
 */
export function makeFrame(humerus) {
  const zs = []; for (let i = 0; i < humerus.pos.length; i += 3) zs.push(humerus.pos[i + 2]);
  const zMax = Math.max(...zs), zMin = Math.min(...zs);
  const s = OUR_HUMERUS_LENGTH / (zMax - zMin);
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (let i = 0; i < humerus.pos.length; i += 3) if (humerus.pos[i + 2] > zMax - 45) { cx += humerus.pos[i]; cy += humerus.pos[i + 1]; cz += humerus.pos[i + 2]; n++; }
  const head = [cx / n, cy / n, cz / n];
  const map = p => [s * p[0], s * p[2], -s * p[1]];
  const hw = map(head);
  const t = [HEAD_WORLD[0] - hw[0], HEAD_WORLD[1] - hw[1], HEAD_WORLD[2] - hw[2]];
  const toWorld = p => { const m = map(p); return [m[0] + t[0], m[1] + t[1], m[2] + t[2]]; };
  console.log(`scale ${s.toFixed(4)} units/mm, humeral head at mm (${head.map(v => v.toFixed(0)).join(', ')})`);
  return { toWorld, headMm: head, headWorld: HEAD_WORLD, armQuat: quatFromTo([0, -1, 0], ARM_DIR_WORLD) };
}

/** Skin weight: the hanging arm's skin (lateral to the trunk) rotates, the trunk and shoulder cap do not. */
export function skinWeight(p, head) {
  const dz = p[2] - head[2];
  const lateral = Math.abs(p[0]) - Math.abs(head[0]);
  return sstep(25, -70, dz) * sstep(-45, 15, lateral);
}
/** Arm weight of a vertex: 1 along the humeral shaft, 0 at the trunk and above the head. */
export function armWeight(p, head) {
  const dz = p[2] - head[2];
  const radial = Math.hypot(p[0] - head[0], p[1] - head[1]);
  return sstep(30, -80, dz) * sstep(175, 40, radial);
}

export function transform(mesh, frame, pose) {
  const out = new Float32Array(mesh.pos.length);
  for (let i = 0; i < mesh.pos.length; i += 3) {
    const mm = [mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2]];
    let p = frame.toWorld(mm);
    const w = pose === 'arm' ? 1 : (pose === 'blend' ? armWeight(mm, frame.headMm) : (pose === 'skin' ? skinWeight(mm, frame.headMm) : 0));
    if (w > 0) { const h = frame.headWorld; const q = w >= 1 ? frame.armQuat : slerpId(frame.armQuat, w); const r = rotate(q, [p[0] - h[0], p[1] - h[1], p[2] - h[2]]); p = [r[0] + h[0], r[1] + h[1], r[2] + h[2]]; }
    out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
  }
  return out;
}

/** Keeps the connected component with the largest positive signed volume (outer wall of a double-walled solid). */
export function outerShell(mesh) {
  const { pos, idx } = mesh; const n = pos.length / 3; const parent = new Int32Array(n); for (let i = 0; i < n; i++) parent[i] = i;
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]); if (a !== b) parent[a] = b; if (find(c) !== find(b)) parent[find(c)] = find(b); }
  const vol = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const v = (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
    const r = find(idx[t]); vol.set(r, (vol.get(r) || 0) + v);
  }
  let best = -1, bestV = -Infinity; for (const [r, v] of vol) if (v > bestV) { bestV = v; best = r; }
  const keep = []; for (let t = 0; t < idx.length; t += 3) if (find(idx[t]) === best) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  console.log(`  outer shell: ${keep.length / 3} of ${idx.length / 3} triangles, ${vol.size} components, volume ${(bestV / 1e6).toFixed(1)} L`);
  return { pos, idx: keep };
}

/** Removes triangles below zMin (source frame), then caps each large open boundary loop with a fan. */
export function clipAndCap(mesh, zMin, cap) {
  mesh = outerShell(mesh);
  const { pos, idx } = mesh; const keep = [];
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (pos[a * 3 + 2] >= zMin && pos[b * 3 + 2] >= zMin && pos[c * 3 + 2] >= zMin) keep.push(a, b, c); }
  const map = new Map(); const npos = []; const nidx = [];
  for (const i of keep) { let j = map.get(i); if (j === undefined) { j = npos.length / 3; map.set(i, j); npos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); } nidx.push(j); }
  const out = { pos: npos, idx: nidx };
  if (!cap) return out;
  const edges = new Map();
  for (let t = 0; t < nidx.length; t += 3) for (let k = 0; k < 3; k++) { const a = nidx[t + k], b = nidx[t + (k + 1) % 3]; const key = a < b ? `${a}_${b}` : `${b}_${a}`; const e = edges.get(key); if (e) e.n++; else edges.set(key, { a, b, n: 1 }); }
  const next = new Map(); for (const e of edges.values()) if (e.n === 1) next.set(e.a, e.b);
  const seen = new Set(); let loops = 0;
  for (const start of next.keys()) {
    if (seen.has(start)) continue; const loop = []; let v = start; let guard = 0;
    while (v !== undefined && !seen.has(v) && guard++ < 100000) { seen.add(v); loop.push(v); v = next.get(v); }
    if (loop.length < 24) continue; loops++;
    let cx = 0, cy = 0, cz = 0; for (const i of loop) { cx += npos[i * 3]; cy += npos[i * 3 + 1]; cz += npos[i * 3 + 2]; }
    const ci = npos.length / 3; npos.push(cx / loop.length, cy / loop.length, cz / loop.length);
    for (let k = 0; k < loop.length; k++) { const a = loop[k], b = loop[(k + 1) % loop.length]; nidx.push(ci, b, a); }
  }
  console.log(`  clipped at z>=${zMin}: ${npos.length / 3} vertices, ${loops} cap loops`);
  return out;
}

export function normals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}
export function smoothNormals(pos, idx, nor, iters) {
  const n = pos.length / 3; const nb = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b); }
  let cur = Float32Array.from(nor);
  for (let it = 0; it < iters; it++) {
    const out = new Float32Array(cur.length);
    for (let v = 0; v < n; v++) { let x = cur[v * 3], y = cur[v * 3 + 1], z = cur[v * 3 + 2]; for (const u of nb[v]) { x += cur[u * 3]; y += cur[u * 3 + 1]; z += cur[u * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; out[v * 3] = x / l; out[v * 3 + 1] = y / l; out[v * 3 + 2] = z / l; }
    cur = out;
  }
  return cur;
}

/** Minimal GLB writer: one mesh per node, positions + normals + indices. */
export function writeGlb(path, meshes, copyright) {
  const bin = [], views = [], accessors = [], gMeshes = [], nodes = [];
  let offset = 0;
  const push = (arr, target) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    bin.push(buf, Buffer.alloc(pad));
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    offset += buf.length + pad; return views.length - 1;
  };
  for (const m of meshes) {
    const pos = m.pos, nor = m.nor, idx = Uint32Array.from(m.idx);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
    const pv = push(pos, 34962), nv = push(nor, 34962), iv = push(idx, 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: nv, componentType: 5126, count: nor.length / 3, type: 'VEC3' });
    accessors.push({ bufferView: iv, componentType: 5125, count: idx.length, type: 'SCALAR' });
    const a = accessors.length - 3;
    gMeshes.push({ name: m.id, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2 }] });
    nodes.push({ name: m.id, mesh: gMeshes.length - 1 });
  }
  const binBuf = Buffer.concat(bin);
  const json = { asset: { version: '2.0', generator: 'virtual-cadaver tools', copyright },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes: gMeshes, accessors, bufferViews: views, buffers: [{ byteLength: binBuf.length }] };
  let jsonBuf = Buffer.from(JSON.stringify(json)); const jp = (4 - (jsonBuf.length % 4)) % 4; jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jp, 0x20)]);
  const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  writeFileSync(path, Buffer.concat([header, jh, jsonBuf, bh, binBuf]));
}
