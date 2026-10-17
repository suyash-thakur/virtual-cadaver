// Converts Z-Anatomy objects (exported as OBJ by tools/zanatomy-export.py) into
// public/assets/zanatomy.glb, mapped onto our structure ids, and registers the group in
// public/assets/manifest.json. Z-Anatomy is CC BY-SA 4.0 (base models BodyParts3D CC BY-SA 2.1 JP).
//
//   npm run zanatomy            # after the Blender export
//
// Z-Anatomy is in metres with the BodyParts3D axes (x patient-left, y posterior, z superior).
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseObj, merge, scaleMesh, makeFrame, transform, normals, writeGlb, clipAndCap, CLIP_BELOW_HEAD_MM } from './lib/mesh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OBJ = resolve(here, '.zanatomy-cache/obj');
const OUT = resolve(here, '../public/assets');
const LICENSE = 'Z-Anatomy, the libre 3D atlas of anatomy (Gauthier Kervyn and contributors), CC BY-SA 4.0, https://github.com/Z-Anatomy/Models-of-human-anatomy. Base models: BodyParts3D, (c) The Database Center for Life Science, CC BY-SA 2.1 Japan.';

/** Our structure id → Z-Anatomy object names (right side). */
const MAP = {
  pecMajor: { names: ['Clavicular head of pectoralis major muscle.r', 'Sternocostal head of pectoralis major muscle.r', '(Abdominal part of pectoralis major muscle).r'], pose: 'blend' },
  deltoid: { names: ['Clavicular part of deltoid muscle.r', 'Acromial part of deltoid muscle.r', 'Scapular spinal part of deltoid muscle.r'], pose: 'blend' },
  latissimus: { names: ['Latissimus dorsi muscle.r'], pose: 'blend' },
  clavipectoral: { names: ['Clavipectoral fascia.r'] },
  nodes: { names: ['Anterior axillary nodes.r', 'Posterior axillary nodes.r', 'Central axillary nodes.r', 'Lateral axillary nodes.r', 'Apical axillary nodes.r'], pose: 'blend' },
};

const manifest = JSON.parse(readFileSync(resolve(OBJ, 'manifest.json'), 'utf8'));
const byName = new Map(manifest.map(m => [m.name, m.file]));
const load = name => { const f = byName.get(name); if (!f) { console.warn(`missing in export: ${name}`); return null; } return scaleMesh(parseObj(resolve(OBJ, f)), 1000); };

const humerus = load('Humerus.r'); if (!humerus) throw new Error('Humerus.r is needed to fit the frame');
const frame = makeFrame(humerus);
const meshes = [];
for (const [id, spec] of Object.entries(MAP)) {
  const parts = spec.names.map(load).filter(Boolean); if (!parts.length) continue;
  const raw = clipAndCap(merge(parts), frame.headMm[2] - CLIP_BELOW_HEAD_MM, false);
  const pos = transform(raw, frame, spec.pose), nor = normals(pos, raw.idx);
  meshes.push({ id, pos, nor, idx: raw.idx });
  console.log(`${id}: ${pos.length / 3} vertices from ${parts.length} part(s)`);
}
writeGlb(resolve(OUT, 'zanatomy.glb'), meshes, LICENSE);
const mf = resolve(OUT, 'manifest.json');
const m = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : { license: '', groups: {} };
m.groups.zanatomy = meshes.map(x => x.id);
m.sizes = Object.assign({}, m.sizes, { zanatomy: statSync(resolve(OUT, 'zanatomy.glb')).size });
m.licenses = Object.assign({}, m.licenses, { zanatomy: LICENSE });
writeFileSync(mf, JSON.stringify(m, null, 1));
writeFileSync(resolve(OUT, 'ATTRIBUTION.txt'), (m.license ? m.license + '\n' : '') + LICENSE + '\n');
console.log('wrote', resolve(OUT, 'zanatomy.glb'));
