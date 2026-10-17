import { Mesh, Vector3, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Specimen } from './specimen';
import type { RT } from './registry';
import { ensureBVH } from './bvh';

interface Manifest { license: string; groups: Record<string, string[]> }

const pending = new Map<string, BufferGeometry>();
/** The real skin mesh, kept for `Specimen.buildBody`. */
export let realSkin: BufferGeometry | null = null;

function install(spec: Specimen, d: RT, geo: BufferGeometry) {
  for (const m of d.meshes) { spec.scene.remove(m); m.geometry.dispose(); }
  for (const h of d.hits) { spec.scene.remove(h); h.geometry.dispose(); }
  d.meshes = []; d.hits = [];
  geo.computeBoundingSphere(); ensureBVH(geo);
  const mesh = new Mesh(geo, d.mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.sid = d.id; spec.scene.add(mesh); d.meshes.push(mesh);
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
export interface DownloadProgress { loaded: number; total: number; files: number; done: number }

/** Streams a file, reporting bytes as they arrive. `total` comes from Content-Length when the server sends it. */
async function fetchWithProgress(url: string, onBytes: (delta: number, total: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body) { const buf = await res.arrayBuffer(); onBytes(buf.byteLength, total || buf.byteLength); return buf; }
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.byteLength; onBytes(value.byteLength, total); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out.buffer;
}

/** Sizes of the asset files, fetched with HEAD requests in parallel so the bar can show a true total from the start. */
async function totalSize(urls: string[]): Promise<number> {
  const sizes = await Promise.all(urls.map(u => fetch(u, { method: 'HEAD' }).then(r => Number(r.headers.get('content-length') || 0)).catch(() => 0)));
  return sizes.reduce((a, b) => a + b, 0);
}

export async function loadAssets(spec: Specimen, onProgress?: (p: DownloadProgress) => void, base = import.meta.env.BASE_URL): Promise<string[]> {
  let manifest: Manifest;
  try {
    const res = await fetch(`${base}assets/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return [];
    manifest = await res.json();
  } catch { return []; }
  const loader = new GLTFLoader();
  const replaced: string[] = [];
  const groups = Object.keys(manifest.groups); const urls = groups.map(g => `${base}assets/${g}.glb`);
  const prog: DownloadProgress = { loaded: 0, total: 0, files: groups.length, done: 0 };
  prog.total = await totalSize(urls); onProgress?.(prog);
  // Download everything in parallel (the files are independent), parse in manifest order.
  const perFileTotal = new Map<string, number>();
  const buffers = await Promise.all(urls.map(u => fetchWithProgress(u, (delta, total) => {
    prog.loaded += delta;
    if (total && !perFileTotal.has(u)) { perFileTotal.set(u, total); if (!prog.total) prog.total = [...perFileTotal.values()].reduce((a, b) => a + b, 0); }
    onProgress?.(prog);
  }).catch(e => { console.warn(`asset ${u} failed to download`, e); return null; })));
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi], buf = buffers[gi]; if (!buf) continue;
    let gltf;
    try { gltf = await loader.parseAsync(buf, `${base}assets/`); }
    catch (e) { console.warn(`asset group ${group} failed to parse`, e); continue; }
    prog.done++; onProgress?.(prog);
    gltf.scene.traverse(obj => {
      if (!(obj instanceof Mesh)) return;
      const id = obj.name; const geo = obj.geometry as BufferGeometry;
      if (id === 'skin') { realSkin = geo; replaced.push('skin (body)'); return; }
      if (!spec.R.has(id)) { pending.set(id, geo); return; }
      install(spec, spec.R.get(id), geo); replaced.push(id);
    });
  }
  return replaced;
}

/** Positions of assets not yet installed, so the skin can be fitted around them too. */
export function pendingPositions(): Float32Array[] { return [...pending.values()].map(g => g.attributes.position.array as Float32Array); }

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
