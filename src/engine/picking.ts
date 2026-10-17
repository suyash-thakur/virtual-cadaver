import { Raycaster, Vector2, Vector3, type Intersection, type Mesh, type PerspectiveCamera } from 'three';
import type { Registry, RT } from './registry';

/** True if the hit lands on a part of a skin shell that has already been peeled away. */
export function hitIsCut(h: Intersection, R: Registry): boolean {
  const m = h.object as Mesh;
  if (!m.userData.shell || !h.face) return false;
  const g = m.geometry, pe = g.attributes.peel, wa = g.attributes.warm, d = R.get(m.userData.sid), u = d.peel!;
  const f = h.face, peel = (pe.getX(f.a) + pe.getX(f.b) + pe.getX(f.c)) / 3, w = (wa.getX(f.a) + wa.getX(f.b) + wa.getX(f.c)) / 3;
  const mk = g.attributes.mask; if (mk && (mk.getX(f.a) + mk.getX(f.b) + mk.getX(f.c)) / 3 > 0.5) return true;
  return peel < u.uCutT.value * (1 - w) + u.uCutA.value * w;
}

export class Picker {
  private ray = new Raycaster();
  private ndc = new Vector2();
  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private R: Registry) {}

  /** Returns the structure under a client-space point, preferring nerves (they have fat hit tubes). */
  pick(cx: number, cy: number): { d: RT; point: Vector3 } | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const nh: Mesh[] = [], sh: Mesh[] = [];
    for (const d of this.R.order) {
      if (d.layer === 'nerves') { if (d.cur > .2) nh.push(...d.hits); continue; }
      if (d.cur * d.op > .25) sh.push(...d.meshes.filter(m => m.visible));
    }
    const a = this.ray.intersectObjects(nh, false)[0];
    const b = this.ray.intersectObjects(sh, false).find(h => !hitIsCut(h, this.R));
    let hit: Intersection | undefined;
    if (a && (!b || a.distance < b.distance + 1.6)) hit = a; else if (b) hit = b;
    if (!hit) return null;
    const d = this.R.get((hit.object as Mesh).userData.sid);
    const point = d.layer === 'nerves' && d.curve ? nearestOnCurve(d, hit.point) : hit.point;
    return { d, point };
  }

  occludingIds(anchor: Vector3, own: RT, occluders: Mesh[]): string[] { return occludingIdsOf(this.ray, this.camera, anchor, own, occluders, this.R); }
  private occRay = Object.assign(new Raycaster(), { firstHitOnly: true });

  /** Occlusion test for labels: is the anchor hidden behind another opaque structure? */
  occluded(anchor: Vector3, own: RT, occluders: Mesh[]): boolean {
    const dir = anchor.clone().sub(this.camera.position); const dist = dir.length(); dir.normalize();
    const ray = this.occRay; ray.set(this.camera.position, dir); ray.far = dist - 0.6;
    // With firstHitOnly each mesh reports its nearest triangle only; sort and take the closest few.
    const hits = ray.intersectObjects(occluders, false);
    ray.far = Infinity;
    for (const h of hits) { const sid = (h.object as Mesh).userData.sid; if (sid === own.id) continue; if (hitIsCut(h, this.R)) continue; return true; }
    return false;
  }
}

export function occludingIdsOf(ray: Raycaster, camera: PerspectiveCamera, anchor: Vector3, own: RT, occluders: Mesh[], R: Registry): string[] {
  const dir = anchor.clone().sub(camera.position); const dist = dir.length(); dir.normalize();
  ray.set(camera.position, dir); ray.far = dist - 0.6;
  const hits = ray.intersectObjects(occluders, false); ray.far = Infinity;
  const out = new Set<string>();
  for (const h of hits) { const sid = (h.object as Mesh).userData.sid; if (sid === own.id || hitIsCut(h, R)) continue; out.add(sid); }
  return [...out];
}

export function nearestOnCurve(d: RT, p: Vector3): Vector3 {
  let best: Vector3 | null = null, bd = Infinity;
  d.curve!.getSpacedPoints(80).forEach(q => { const k = q.distanceToSquared(p); if (k < bd) { bd = k; best = q; } });
  return best || p;
}
export function curveParamNear(d: RT, p: Vector3): number {
  const pts = d.curve!.getSpacedPoints(80); let bi = 0, bd = Infinity;
  pts.forEach((q, i) => { const k = q.distanceToSquared(p); if (k < bd) { bd = k; bi = i; } });
  return bi / 80;
}
