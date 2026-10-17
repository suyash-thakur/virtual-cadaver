import { Mesh, Vector3, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Specimen } from './specimen';
import type { RT } from './registry';

interface Manifest { license: string; groups: Record<string, string[]> }

const pending = new Map<string, BufferGeometry>();

function install(spec: Specimen, d: RT, geo: BufferGeometry) {
  for (const m of d.meshes) { spec.scene.remove(m); m.geometry.dispose(); }
  for (const h of d.hits) { spec.scene.remove(h); h.geometry.dispose(); }
  d.meshes = []; d.hits = [];
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, d.mat); mesh.userData.sid = d.id; spec.scene.add(mesh); d.meshes.push(mesh);
  // The body field keeps the smooth procedural coverage; only structures that had none are sampled.
  if (!d.cov.length) {
    const p = geo.attributes.position; const step = Math.max(1, Math.floor(p.count / 400));
    for (let i = 0; i < p.count; i += step) d.cov.push({ pt: new Vector3(p.getX(i), p.getY(i), p.getZ(i)), r: .3 });
  }
  // Real meshes have no UVs, so the fibre textures would smear one texel; use plain shading.
  const mat = d.mat as unknown as { map: unknown; bumpMap: unknown; needsUpdate: boolean };
  if (mat.map) { mat.map = null; mat.bumpMap = null; mat.needsUpdate = true; }
  d.real = true;
}

/**
 * Replaces procedural meshes with real geometry from `public/assets/<group>.glb` when the
 * file exists. The app works without assets, so a missing manifest is not an error.
 * Structures that are not registered yet (the surface veins built with the body) are kept
 * until `applyPendingAssets` runs. Returns the ids replaced now.
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
      const id = obj.name; const geo = obj.geometry as BufferGeometry;
      if (!spec.R.has(id)) { pending.set(id, geo); return; }
      install(spec, spec.R.get(id), geo); replaced.push(id);
    });
  }
  return replaced;
}

/** Installs meshes for structures that were registered after `loadAssets` ran. */
export function applyPendingAssets(spec: Specimen): string[] {
  const done: string[] = [];
  for (const [id, geo] of pending) {
    if (!spec.R.has(id)) { console.warn(`asset ${id} has no structure`); continue; }
    const d = spec.R.get(id);
    install(spec, d, geo); d.anchor = d.curve ? d.anchor : boxCentre(geo); done.push(id); pending.delete(id);
  }
  return done;
}

function boxCentre(geo: BufferGeometry): Vector3 { geo.computeBoundingBox(); return geo.boundingBox!.getCenter(new Vector3()); }
