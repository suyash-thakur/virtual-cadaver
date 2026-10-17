/**
 * Real body surface: the BodyParts3D skin mesh (clipped and posed by the asset tool) becomes
 * the skin shell, and two inward offsets of it become the superficial fascia and deep fascia
 * shells. Replaces the implicit-surface blob when `assets/body.glb` is present.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Float32BufferAttribute, Raycaster, Vector3, Mesh, MeshBasicMaterial } from 'three';
import { peelAt } from './geometry/body';
import { noise3 } from './noise';
import { ensureBVH } from './bvh';

export interface BodyShells { skin: BufferGeometry; fat: BufferGeometry; deepFascia: BufferGeometry }

/** Offsets in world units, matching the iso levels of the procedural field. */
export const SHELL_OFFSET: Record<string, number> = { skin: 0, fat: -0.45, deepFascia: -1.0 };

function offsetGeometry(src: BufferGeometry, offset: number): BufferGeometry {
  const p = src.attributes.position, n = src.attributes.normal;
  const out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { out[i * 3] = p.getX(i) + n.getX(i) * offset; out[i * 3 + 1] = p.getY(i) + n.getY(i) * offset; out[i * 3 + 2] = p.getZ(i) + n.getZ(i) * offset; }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(out, 3));
  // Own copy of the index: BVH builds reorder it in place, so sharing one would corrupt the other shells' trees.
  g.setIndex(new BufferAttribute((src.index!.array as Uint32Array).slice(), 1));
  g.computeVertexNormals();
  return g;
}

/** Adds peel order, trunk/arm weight, tone colour, cut mask and planar UVs to a shell. */
export function decorateShell(g: BufferGeometry, tone: [number, number, number]): void {
  const p = g.attributes.position, n = p.count;
  const peel = new Float32Array(n), warm = new Float32Array(n), col = new Float32Array(n * 3), mask = new Float32Array(n), uv = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) {
    const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
    const l = -x, s = y, a = z; // authoring space
    const pw = peelAt(l, s, a); peel[v] = pw[0]; warm[v] = pw[1];
    const t = tone[0] + tone[1] * noise3(l * tone[2], s * tone[2], a * tone[2]);
    col[v * 3] = t; col[v * 3 + 1] = t; col[v * 3 + 2] = t;
    uv[v * 2] = x * 0.35; uv[v * 2 + 1] = y * 0.35;
  }
  g.setAttribute('peel', new BufferAttribute(peel, 1));
  g.setAttribute('warm', new BufferAttribute(warm, 1));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('mask', new BufferAttribute(mask, 1));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}

/** Makes the winding outward-facing: offsets and backface shading depend on it. */
function orientOutward(g: BufferGeometry): void {
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  void n;
  // Signed volume: positive for outward counter-clockwise winding.
  const idx = g.index!.array; let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a), bx = p.getX(b), by = p.getY(b), bz = p.getZ(b), cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0 && g.index) { const idx = g.index.array; for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; } g.index.needsUpdate = true; g.computeVertexNormals(); }
}

export function buildShells(skin: BufferGeometry): BodyShells {
  orientOutward(skin);
  return { skin, fat: offsetGeometry(skin, SHELL_OFFSET.fat), deepFascia: offsetGeometry(skin, SHELL_OFFSET.deepFascia) };
}

/**
 * Surface queries against the real skin, replacing the field marches: casts from `start`
 * along `dir` (authoring space) and returns the hit on the shell at `iso` depth, or null.
 */
export class SkinProjector {
  private ray = Object.assign(new Raycaster(), { firstHitOnly: true });
  private probe: Mesh;
  constructor(skin: BufferGeometry) { ensureBVH(skin, 1); this.probe = new Mesh(skin, new MeshBasicMaterial({ side: DoubleSide })); this.probe.updateMatrixWorld(); }
  /** Inputs and output in authoring space [l, s, a]; the skin mesh is in world space (x mirrored). */
  proj(start: number[], dir: number[], iso: number): number[] | null {
    const o = new Vector3(-start[0], start[1], start[2]), d = new Vector3(-dir[0], dir[1], dir[2]).normalize();
    this.ray.set(o, d); this.ray.far = 90;
    const hit = this.ray.intersectObject(this.probe, false)[0];
    if (!hit || !hit.face) return null;
    // The entry face normal, forced to point back toward the ray so iso < 0 always moves inward.
    const nrm = hit.face.normal.clone(); if (nrm.dot(d) > 0) nrm.negate();
    const p = hit.point.clone().addScaledVector(nrm, iso);
    return [-p.x, p.y, p.z];
  }
}
