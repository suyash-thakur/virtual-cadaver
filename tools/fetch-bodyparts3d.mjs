// Downloads BodyParts3D (DBCLS, CC BY-SA 2.1 JP) and converts the structures this region
// needs into glTF binaries under public/assets/, one node per structure id.
//
//   node tools/fetch-bodyparts3d.mjs            # bones.glb, muscles.glb, vessels.glb
//   node tools/fetch-bodyparts3d.mjs --dry-run  # just report what would be built
//
// Frame: BodyParts3D is in mm, x toward the patient's left, y toward the back, z superior.
// Our world is x toward the viewer's right (so the patient's right limb reads on the left),
// y superior, z anterior, in roughly centimetre units. The arm hangs in BodyParts3D but is
// abducted in our specimen, so arm structures rotate about the humeral head ('arm'), and
// vessels that cross from trunk to arm are skinned with a weight that fades toward the trunk
// ('blend'). The broad shoulder muscles (pectoralis major, deltoid, latissimus dorsi) stay
// procedural: their thin triangles tear under skinning and they need the reflection animation.
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
const ARCHIVES = {
  partof: { zip: 'partof_BP3D_4.0_obj_99.zip', dir: 'partof_BP3D_4.0_obj_99', elements: 'partof_element_parts.txt' },
  isa: { zip: 'isa_BP3D_4.0_obj_99.zip', dir: 'isa_BP3D_4.0_obj_99', elements: 'isa_element_parts.txt' },
};
const LICENSE = 'BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan. http://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html';
const dry = process.argv.includes('--dry-run');

/**
 * Our structure id → FMA concept ids. `arch` picks the archive (part-of has whole bones,
 * is-a has muscle heads and the arm vessels). `pose`: 'arm' rotates every vertex with the
 * abducted arm, 'blend' weights the rotation by closeness to the humeral shaft, none is static.
 */
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
    pecMinor: { arch: 'isa', names: ['right pectoralis minor'] },
    biceps: { arch: 'isa', names: ['long head of right biceps brachii', 'short head of right biceps brachii'], pose: 'arm' },
    triceps: { arch: 'isa', names: ['long head of right triceps brachii', 'lateral head of right triceps brachii', 'medial head of right triceps brachii'], pose: 'arm' },
    brachialis: { arch: 'isa', names: ['right brachialis'], pose: 'arm' },
    coraco: { arch: 'isa', names: ['right coracobrachialis'], pose: 'arm' },
    trapezius: { arch: 'isa', names: ['descending part of right trapezius', 'transverse part of right trapezius', 'ascending part of right trapezius'] },
    antScalene: { arch: 'isa', names: ['right scalenus anterior'] },
    midScalene: { arch: 'isa', names: ['right scalenus medius'] },
    scm: { arch: 'isa', names: ['right sternocleidomastoid'] },
    omohyoid: { arch: 'isa', names: ['right omohyoid'] },
    teresMajor: { arch: 'isa', names: ['right teres major'], pose: 'blend' },
    teresMinor: { arch: 'isa', names: ['right teres minor'] },
    supraspinatus: { arch: 'isa', names: ['right supraspinatus'] },
    infraspinatus: { arch: 'isa', names: ['right infraspinatus muscle'] },
    subscap: { arch: 'isa', names: ['right subscapularis'] },
    platysma: { arch: 'isa', names: ['right platysma'] },
  },
  vessels: {
    subclavianA: { arch: 'isa', names: ['right subclavian artery'] },
    subclavianV: { arch: 'isa', names: ['right subclavian vein'] },
    axillaryA: { arch: 'isa', names: ['right axillary artery'], pose: 'blend' },
    axillaryV: { arch: 'isa', names: ['right axillary vein'], pose: 'blend' },
    brachialA: { arch: 'isa', names: ['right brachial artery'], pose: 'blend' },
    profunda: { arch: 'isa', names: ['right deep brachial artery'], pose: 'blend' },
    thoracoacromial: { arch: 'isa', names: ['trunk of right thoraco-acromial artery', 'pectoral branch of right thoraco-acromial artery', 'acromial branch of right thoraco-acromial artery', 'deltoid branch of right thoraco-acromial artery'] },
    lateralThoracic: { arch: 'isa', names: ['right lateral thoracic artery'] },
    subscapularA: { arch: 'isa', names: ['right subscapular artery'] },
    antCircHumeral: { arch: 'isa', names: ['right anterior circumflex humeral artery'], pose: 'blend' },
    postCircHumeral: { arch: 'isa', names: ['right posterior circumflex humeral artery'], pose: 'blend' },
    cephalicV: { arch: 'isa', names: ['right cephalic vein'], pose: 'blend' },
    basilicV: { arch: 'isa', names: ['right basilic vein'], pose: 'blend' },
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

function readTable(path) { return readFileSync(path, 'utf8').split('\n').slice(1).map(l => l.split('\t')).filter(r => r.length >= 3); }
/** FMA concept → element files; falls back to a name match ("right X" or "X") when the id is not in the table. */
function elementsFor(table, byName, fma, name) {
  let e = table.filter(r => r[0] === fma).map(r => r[2]);
  if (!e.length && name) e = byName.get(name) || [];
  return e;
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

function quatFromTo(a, b) {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const w = 1 + d; const n = Math.hypot(c[0], c[1], c[2], w);
  return [c[0] / n, c[1] / n, c[2] / n, w / n];
}
function slerpId(q, t) { // interpolate between identity and q
  const ang = 2 * Math.acos(Math.min(1, q[3])); if (ang < 1e-6) return [0, 0, 0, 1];
  const s = Math.sin(ang / 2); const ax = [q[0] / s, q[1] / s, q[2] / s]; const h = ang * t / 2;
  return [ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h), Math.cos(h)];
}
function rotate(q, v) {
  const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** BodyParts3D mm → our world, before any pose rotation. */
function makeFrame(humerus) {
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

/** Arm weight of a BodyParts3D vertex: 1 along the humeral shaft, 0 at the trunk and above the head. */
function armWeight(p, head) {
  const dz = p[2] - head[2];
  const radial = Math.hypot(p[0] - head[0], p[1] - head[1]);
  return sstep(30, -80, dz) * sstep(175, 40, radial);
}

function transform(mesh, frame, pose) {
  const out = new Float32Array(mesh.pos.length);
  for (let i = 0; i < mesh.pos.length; i += 3) {
    const mm = [mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2]];
    let p = frame.toWorld(mm);
    const w = pose === 'arm' ? 1 : (pose === 'blend' ? armWeight(mm, frame.headMm) : 0);
    if (w > 0) { const h = frame.headWorld; const q = w >= 1 ? frame.armQuat : slerpId(frame.armQuat, w); const r = rotate(q, [p[0] - h[0], p[1] - h[1], p[2] - h[2]]); p = [r[0] + h[0], r[1] + h[1], r[2] + h[2]]; }
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
  const tables = {}, zips = {};
  for (const [k, a] of Object.entries(ARCHIVES)) {
    tables[k] = readTable(await download(a.elements));
    tables[k].byName = new Map(); for (const r of tables[k]) { const n = r[1].toLowerCase(); if (!tables[k].byName.has(n)) tables[k].byName.set(n, []); tables[k].byName.get(n).push(r[2]); }
  }
  const needed = new Map(); const perArchive = { partof: new Set(), isa: new Set() };
  for (const group of Object.values(GROUPS)) for (const [id, spec] of Object.entries(group)) {
    const arch = spec.arch || 'partof';
    const keys = spec.fma || spec.names;
    const files = keys.flatMap(k => { const e = spec.fma ? elementsFor(tables[arch], tables[arch].byName, k) : (tables[arch].byName.get(k) || []); if (!e.length) console.warn(`no elements for ${k} (${id}) in ${arch}`); return e; });
    needed.set(id, { arch, files }); files.forEach(f => perArchive[arch].add(f));
  }
  console.log(`${perArchive.partof.size} part-of files, ${perArchive.isa.size} is-a files for ${needed.size} structures`);
  if (dry) return;
  for (const [k, a] of Object.entries(ARCHIVES)) {
    if (!perArchive[k].size) continue;
    zips[k] = await download(a.zip);
    const missing = [...perArchive[k]].filter(f => !existsSync(resolve(CACHE, `${a.dir}/${f}.obj`)));
    if (missing.length) execFileSync('unzip', ['-o', '-q', zips[k], ...missing.map(f => `${a.dir}/${f}.obj`), '-d', CACHE]);
  }
  const load = id => { const n = needed.get(id); return merge(n.files.map(f => parseObj(resolve(CACHE, `${ARCHIVES[n.arch].dir}/${f}.obj`)))); };
  const frame = makeFrame(load('humerus'));
  const manifest = { license: LICENSE, groups: {} };
  for (const [gname, group] of Object.entries(GROUPS)) {
    const meshes = [];
    for (const [id, spec] of Object.entries(group)) {
      const raw = load(id); if (!raw.pos.length) { console.warn(`skipping ${id}: no geometry`); continue; }
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
