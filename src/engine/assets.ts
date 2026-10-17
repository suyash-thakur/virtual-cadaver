import { Mesh, Vector3, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Specimen } from './specimen';

interface Manifest { license: string; groups: Record<string, string[]> }

/**
 * Replaces procedural meshes with real geometry from `public/assets/<group>.glb` when the
 * file exists. The app works without assets, so a missing manifest is not an error.
 * Returns the ids that were replaced.
 */
export async function loadAssets(spec: Specimen, base = import.meta.env.BASE_URL): Promise<string[]> {
  let manifest: Manifest;
  try {
    const res = await fetch(`${base}assets/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return [];
    manifest = await res.json();
  } catch { return []; }
  const loader = new GLTFLoader();
  const replaced: string[] = [];
  for (const group of Object.keys(manifest.groups)) {
    let gltf;
    try { gltf = await loader.loadAsync(`${base}assets/${group}.glb`); }
    catch (e) { console.warn(`asset group ${group} failed to load`, e); continue; }
    gltf.scene.traverse(obj => {
      if (!(obj instanceof Mesh)) return;
      const id = obj.name; if (!spec.R.has(id)) { console.warn(`asset ${id} has no structure`); return; }
      const d = spec.R.get(id);
      for (const m of d.meshes) { spec.scene.remove(m); m.geometry.dispose(); }
      for (const h of d.hits) { spec.scene.remove(h); h.geometry.dispose(); }
      d.meshes = []; d.hits = [];
      const geo = obj.geometry as BufferGeometry; geo.computeBoundingSphere();
      const mesh = new Mesh(geo, d.mat); mesh.userData.sid = id; spec.scene.add(mesh); d.meshes.push(mesh);
      // Coverage for the body field: sample the real surface instead of the old primitives.
      const p = geo.attributes.position; const step = Math.max(1, Math.floor(p.count / 160));
      d.cov = [];
      for (let i = 0; i < p.count; i += step) d.cov.push({ pt: new Vector3(p.getX(i), p.getY(i), p.getZ(i)), r: .3 });
      d.real = true;
      replaced.push(id);
    });
  }
  return replaced;
}
