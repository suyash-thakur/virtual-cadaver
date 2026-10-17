// Extracts the anatomy content out of the single-file prototype into versioned JSON.
// Usage: node tools/extract-content.mjs [path/to/brachial-plexus-dissection.html]
// The prototype's own data blocks are evaluated with a stub vector class, so the
// coordinates and text are taken verbatim rather than retyped.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || resolve(process.env.HOME, 'Downloads/brachial-plexus-dissection.html');
const outDir = resolve(here, '../src/content/data');
const lines = readFileSync(src, 'utf8').split('\n');
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

const between = (startRe, endRe) => {
  const s = lines.findIndex(l => startRe.test(l));
  if (s < 0) throw new Error(`start not found: ${startRe}`);
  const e = lines.findIndex((l, i) => i > s && endRe.test(l));
  if (e < 0) throw new Error(`end not found: ${endRe}`);
  return slice(s + 1, e);
};

const code = [
  `const THREE = { Vector3: class { constructor(x=0,y=0,z=0){ this.x=x; this.y=y; this.z=z; } toJSON(){ return [this.x,this.y,this.z]; } } };`,
  between(/^const V = /, /^const NERVES = /),
  between(/^const NERVES = /, /^\/\* ---------- Three.js setup/),
  between(/^const SHELLS = /, /^function addSurface/),
  between(/^const MUSCLES = /, /^const LES = /),
  between(/^const THUMB = /, /^function mapSVG/),
  `return { FAM, CLASSIC, CAD_NERVE, ROOTS, NERVES, OTHERS, SURFACE_INFO, VESSELS, M_NERVES, STEPS, INC_NAMES, VIEWS, SHELLS, MUSCLES, SENS, ROOT_IDS, LESIONS, LIMB, REG, BONE, BONE_CAD, MUS_CAD, ART, ART_CAD, VEIN, VEIN_CAD, FASCIA };`
].join('\n');

const D = new Function(code)();
const vec = v => (v && typeof v === 'object' && 'x' in v) ? [v.x, v.y, v.z] : v;
const deep = o => JSON.parse(JSON.stringify(o, (k, v) => vec(v)));

const nerves = D.NERVES.map(n => ({ ...deep(n), layer: 'nerves' }));
const others = D.OTHERS.map(deep);
const structures = [...nerves, ...others];

const write = (name, obj) => { writeFileSync(resolve(outDir, name), JSON.stringify(obj, null, 1) + '\n'); console.log('wrote', name); };
mkdirSync(outDir, { recursive: true });
write('structures.json', { version: 1, region: 'brachial-plexus', structures });
write('surface.json', { version: 1, surfaces: D.SURFACE_INFO, shells: D.SHELLS });
write('steps.json', { version: 1, steps: D.STEPS, incisionNames: D.INC_NAMES, vesselIds: D.VESSELS, mNerveIds: D.M_NERVES });
write('views.json', { version: 1, views: D.VIEWS });
write('palette.json', { version: 1, families: D.FAM, classicNerve: D.CLASSIC, cadaverNerve: D.CAD_NERVE, roots: D.ROOTS,
  bone: D.BONE, boneCadaver: D.BONE_CAD, muscleCadaver: D.MUS_CAD, artery: D.ART, arteryCadaver: D.ART_CAD, vein: D.VEIN, veinCadaver: D.VEIN_CAD, fascia: D.FASCIA });
write('muscles.json', { version: 1, muscles: D.MUSCLES, sensory: D.SENS });
write('lesions.json', { version: 1, rootIds: D.ROOT_IDS, lesions: D.LESIONS });
write('skinmap.json', { version: 1, limb: D.LIMB, regions: D.REG });
console.log(`structures: ${structures.length} (${nerves.length} nerves), steps: ${D.STEPS.length}, lesions: ${D.LESIONS.length}, muscles: ${D.MUSCLES.length}`);
