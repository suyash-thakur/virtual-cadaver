import { Vector3 } from 'three';
import type { Vec3 } from '../content';

/**
 * Authoring space: l = lateral (to the patient's right), s = superior, a = anterior.
 * World x is mirrored so the right limb appears on the viewer's left, as in a front view.
 */
export const V = (l: number, s: number, a: number) => new Vector3(-l, s, a);
/** World-space content array to Vector3 (no mirroring, the content is already in world space). */
export const v3 = (p: Vec3) => new Vector3(p[0], p[1], p[2]);
/** Authoring-space content array to world Vector3. */
export const va = (p: Vec3) => V(p[0], p[1], p[2]);

/** Arm frame: t along the humerus from the centre of its head, n toward the medial (axillary) side. */
export function armL(t: number, n: number, z: number): [number, number, number] {
  return [16 + 0.643 * t - 0.766 * n, 0.3 - 0.766 * t - 0.643 * n, z];
}
/** Unit direction around the arm: theta = 0 points lateral, theta = 90° points anterior. */
export function armDir(theta: number): [number, number, number] {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c * 0.766, c * 0.643, s];
}
export const DEG = Math.PI / 180;
/** Centre of the specimen, used to push labels outward. */
export const CENTER = V(12, -1, 0);
