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
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { parseObj, merge, makeFrame, transform, normals, smoothNormals, clipAndCap, writeGlb, CLIP_BELOW_HEAD_MM } from './lib/mesh.mjs';

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
  body: {
    /** Whole-body skin from BodyParts3D, clipped below the lower chest and capped, used as the outer shell. */
    skin: { fma: ['FMA7163'], pose: 'skin', cap: true },
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
      let raw = load(id); if (!raw.pos.length) { console.warn(`skipping ${id}: no geometry`); continue; }
      // Everything is cut at the same rest-frame level as the skin so nothing hangs out of the arm stump.
      raw = clipAndCap(raw, frame.headMm[2] - CLIP_BELOW_HEAD_MM, !!spec.cap, spec.pose === 'skin');
      const pos = transform(raw, frame, spec.pose), nor = normals(pos, raw.idx);
      if (spec.pose === 'skin') { const s = smoothNormals(pos, raw.idx, nor, 2); nor.set(s); }
      meshes.push({ id, pos, nor, idx: raw.idx });
      console.log(`${gname}/${id}: ${pos.length / 3} vertices, ${raw.idx.length / 3} triangles`);
    }
    const file = resolve(OUT, `${gname}.glb`); writeGlb(file, meshes, LICENSE);
    manifest.groups[gname] = meshes.map(m => m.id);
    manifest.sizes = manifest.sizes || {}; manifest.sizes[gname] = statSync(file).size;
    console.log('wrote', file);
  }
  writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeFileSync(resolve(OUT, 'ATTRIBUTION.txt'), LICENSE + '\n');
}
main().catch(e => { console.error(e); process.exit(1); });
