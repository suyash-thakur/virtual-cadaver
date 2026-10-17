// Downloads BodyParts3D (DBCLS, CC BY-SA 2.1 JP) and converts the structures this region
// needs into glTF binaries under public/assets/, one node per structure id.
//
//   node tools/fetch-bodyparts3d.mjs            # bones.glb and muscles.glb
//   node tools/fetch-bodyparts3d.mjs --dry-run  # just report what would be built
//
// Frame: BodyParts3D is in mm, x toward the patient's left, y toward the back, z superior.
// Our world is x toward the viewer's right (so the patient's right limb reads on the left),
// y superior, z anterior, in roughly centimetre units. The arm hangs in BodyParts3D but is
// abducted in our specimen, so arm structures are rotated about the humeral head.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = resolve(here, '.bp3d-cache');
const OUT = resolve(here, '../public/assets');
const BASE = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/';
const ZIP = 'partof_BP3D_4.0_obj_99.zip';
const ELEMENTS = 'partof_element_parts.txt';
const LICENSE = 'BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan. http://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html';
const dry = process.argv.includes('--dry-run');

/** Our structure id → FMA concept ids in the part-of archive. `pose: 'arm'` rotates with the abducted arm. */
const GROUPS = {
  bones: {
    humerus: { fma: ['FMA23130'], pose: 'arm' },
    scapula: { fma: ['FMA13395'] },
    clavicle: { fma: ['FMA13322'] },
    sternum: { fma: ['FMA7485'] },
    rib1: { fma: ['FMA7857'] },
    ribs: { fma: ['FMA7882', 'FMA7909', 'FMA7957', 'FMA8066', 'FMA8175'] },
    vertebrae: { fma: ['FMA12522', 'FMA12523', 'FMA12524', 'FMA12525', 'FMA9165', 'FMA9187'] },
  },
  muscles: {
    serratus: { fma: ['FMA13398'] },
    subclavius: { fma: ['FMA13412'] },
  },
};

/** Fit: humeral head centre in our world, and the direction the humerus points (world). */
const HEAD_WORLD = [-16.306, 0.557, -1.6];
const ARM_DIR_WORLD = [-0.643, -0.766, 0];
const OUR_HUMERUS_LENGTH = 29.4;

async function download(name) {
  const dst = resolve(CACHE, name);
  if (existsSync(dst)) return dst;
  console.log('downloading', name);
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dst));
  return dst;
}

function elementsFor(table, fma) {
  return table.filter(r => r[0] === fma).map(r => r[2]);
}

function parseObj(path) {
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

function merge(parts) {
  const pos = [], idx = [];
  for (const p of parts) { const off = pos.length / 3; pos.push(...p.pos); for (const i of p.idx) idx.push(i + off); }
  return { pos, idx };
}

/** Quaternion rotating unit vector a onto unit vector b. */
function quatFromTo(a, b) {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const w = 1 + d; const n = Math.hypot(c[0], c[1], c[2], w);
  return [c[0] / n, c[1] / n, c[2] / n, w / n];
}
function rotate(q, v) {
  const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

/** BodyParts3D mm → our world, before any pose rotation. */
function makeFrame(humerus) {
  const zs = []; for (let i = 0; i < humerus.pos.length; i += 3) zs.push(humerus.pos[i + 2]);
  const zMax = Math.max(...zs), zMin = Math.min(...zs);
  const s = OUR_HUMERUS_LENGTH / (zMax - zMin);
  // Humeral head centre: centroid of the top 45 mm of the bone.
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (let i = 0; i < humerus.pos.length; i += 3) if (humerus.pos[i + 2] > zMax - 45) { cx += humerus.pos[i]; cy += humerus.pos[i + 1]; cz += humerus.pos[i + 2]; n++; }
  const head = [cx / n, cy / n, cz / n];
  const map = p => [s * p[0], s * p[2], -s * p[1]];
  const hw = map(head);
  const t = [HEAD_WORLD[0] - hw[0], HEAD_WORLD[1] - hw[1], HEAD_WORLD[2] - hw[2]];
  const toWorld = p => { const m = map(p); return [m[0] + t[0], m[1] + t[1], m[2] + t[2]]; };
  console.log(`scale ${s.toFixed(4)} units/mm, humeral head at mm (${head.map(v => v.toFixed(0)).join(', ')})`);
  return { toWorld, headWorld: HEAD_WORLD, armQuat: quatFromTo([0, -1, 0], ARM_DIR_WORLD) };
}

function transform(mesh, frame, pose) {
  const out = new Float32Array(mesh.pos.length);
  for (let i = 0; i < mesh.pos.length; i += 3) {
    let p = frame.toWorld([mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2]]);
    if (pose === 'arm') { const h = frame.headWorld; const r = rotate(frame.armQuat, [p[0] - h[0], p[1] - h[1], p[2] - h[2]]); p = [r[0] + h[0], r[1] + h[1], r[2] + h[2]]; }
    out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
  }
  return out;
}

function normals(pos, idx) {
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

/** Minimal GLB writer: one mesh per node, positions + normals + indices. */
function writeGlb(path, meshes) {
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
  const json = { asset: { version: '2.0', generator: 'virtual-cadaver fetch-bodyparts3d', copyright: LICENSE },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes: gMeshes, accessors, bufferViews: views, buffers: [{ byteLength: binBuf.length }] };
  let jsonBuf = Buffer.from(JSON.stringify(json)); const jp = (4 - (jsonBuf.length % 4)) % 4; jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jp, 0x20)]);
  const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  writeFileSync(path, Buffer.concat([header, jh, jsonBuf, bh, binBuf]));
}

async function main() {
  mkdirSync(CACHE, { recursive: true }); mkdirSync(OUT, { recursive: true });
  const table = readFileSync(await download(ELEMENTS), 'utf8').split('\n').slice(1).map(l => l.split('\t')).filter(r => r.length >= 3);
  const zip = await download(ZIP);
  const needed = new Map();
  for (const group of Object.values(GROUPS)) for (const [id, spec] of Object.entries(group)) {
    const files = spec.fma.flatMap(f => { const e = elementsFor(table, f); if (!e.length) console.warn(`no elements for ${f} (${id})`); return e; });
    needed.set(id, files);
  }
  const all = [...new Set([...needed.values()].flat())];
  console.log(`${all.length} element files for ${needed.size} structures`);
  if (dry) return;
  const missing = all.filter(f => !existsSync(resolve(CACHE, `partof_BP3D_4.0_obj_99/${f}.obj`)));
  if (missing.length) execFileSync('unzip', ['-o', '-q', zip, ...missing.map(f => `partof_BP3D_4.0_obj_99/${f}.obj`), '-d', CACHE]);
  const load = id => merge(needed.get(id).map(f => parseObj(resolve(CACHE, `partof_BP3D_4.0_obj_99/${f}.obj`))));
  const frame = makeFrame(load('humerus'));
  const manifest = { license: LICENSE, groups: {} };
  for (const [gname, group] of Object.entries(GROUPS)) {
    const meshes = [];
    for (const [id, spec] of Object.entries(group)) {
      const raw = load(id); if (!raw.pos.length) continue;
      const pos = transform(raw, frame, spec.pose), nor = normals(pos, raw.idx);
      meshes.push({ id, pos, nor, idx: raw.idx });
      console.log(`${gname}/${id}: ${pos.length / 3} vertices, ${raw.idx.length / 3} triangles`);
    }
    const file = resolve(OUT, `${gname}.glb`); writeGlb(file, meshes);
    manifest.groups[gname] = meshes.map(m => m.id);
    console.log('wrote', file);
  }
  writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeFileSync(resolve(OUT, 'ATTRIBUTION.txt'), LICENSE + '\n');
}
main().catch(e => { console.error(e); process.exit(1); });
