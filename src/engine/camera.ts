import { Box3, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TOUCH } from 'three';
import type { View } from '../content';
import { V } from './coords';
import type { RT } from './registry';

export interface Viewport { W: number; H: number; tb: number; sb: number; pr: number; Hf: number }

const ease = (k: number) => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

/** Camera, orbit controls, viewport layout (around the panel) and animated framing. */
export class CameraRig {
  controls: OrbitControls;
  view: Viewport = { W: 1, H: 1, tb: 0, sb: 0, pr: 0, Hf: 1 };
  private fly: { t0: number; dur: number; ft: Vector3; fp: Vector3; tt: Vector3; tp: Vector3 } | null = null;
  onChange: () => void = () => {};

  constructor(public camera: PerspectiveCamera, canvas: HTMLCanvasElement, private views: Record<string, View>, private reduceMotion: boolean) {
    const c = new OrbitControls(camera, canvas);
    c.enableDamping = true; c.dampingFactor = 0.09; c.rotateSpeed = 0.8; c.zoomSpeed = 0.9; c.panSpeed = 0.8;
    c.minDistance = 5; c.maxDistance = 420; c.zoomToCursor = true;
    c.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    c.addEventListener('start', () => { this.fly = null; });
    c.addEventListener('change', () => this.onChange());
    this.controls = c;
  }

  /** Fits the camera to the part of the canvas not covered by the mode bar, the sheet or the side panel. */
  layout(W: number, H: number, topBar: number, bottomSheet: number, rightPanel: number) {
    const tb = Math.min(topBar, H * .3), sb = Math.min(bottomSheet, H * .62), pr = rightPanel;
    const cy = (tb + H - sb) / 2, dy = cy - H / 2;
    let Hf: number, oy: number; if (dy < 0) { Hf = H - 2 * dy; oy = -2 * dy; } else { Hf = H + 2 * dy; oy = 0; }
    const dx = (W - pr) / 2 - W / 2, Wf = W - 2 * dx, ox = -2 * dx;
    this.camera.aspect = Wf / Hf; this.camera.setViewOffset(Wf, Hf, ox, oy, W, H); this.camera.updateProjectionMatrix();
    this.view = { W, H, tb, sb, pr, Hf };
    this.onChange();
  }

  fitDistance(w: number, h: number): number {
    const t = Math.tan(MathUtils.degToRad(this.camera.fov / 2)), v = this.view;
    const tv = t * Math.max(80, v.H - v.tb - v.sb) / v.Hf, th = t * Math.max(80, v.W - v.pr) / v.Hf;
    return Math.max((h / 2) / tv, (w / 2) / th) * 1.06;
  }

  flyTo(tgt: Vector3, pos: Vector3, dur = 750) {
    if (this.reduceMotion) { this.controls.target.copy(tgt); this.camera.position.copy(pos); this.controls.update(); this.onChange(); return; }
    this.fly = { t0: performance.now(), dur, ft: this.controls.target.clone(), fp: this.camera.position.clone(), tt: tgt.clone(), tp: pos.clone() };
  }

  viewPose(name: string) {
    const v = this.views[name]; if (!v) throw new Error(`unknown view ${name}`);
    const c = V(v.c[0], v.c[1], v.c[2]), dir = V(v.d[0], v.d[1], v.d[2]).normalize();
    return { c, p: c.clone().add(dir.multiplyScalar(this.fitDistance(v.w, v.h))) };
  }
  framePreset(name: string, dur?: number) { const p = this.viewPose(name); this.flyTo(p.c, p.p, dur); }
  snapTo(name: string) { const p = this.viewPose(name); this.controls.target.copy(p.c); this.camera.position.copy(p.p); this.controls.update(); }

  private boxOf(items: RT[]): Box3 | null {
    const box = new Box3(); let any = false;
    for (const d of items) for (const m of d.meshes) { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); m.updateMatrixWorld(); box.expandByObject(m); any = true; }
    return any ? box : null;
  }

  /** Frames a set of structures from the current direction. */
  focusOnSet(items: RT[], dur?: number) {
    const box = this.boxOf(items); if (!box) return;
    const c = box.getCenter(new Vector3()), sz = box.getSize(new Vector3());
    const span = Math.max(sz.x, sz.y, sz.z, 6) * 1.1;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(c, c.clone().add(dir.multiplyScalar(this.fitDistance(span, span))), dur);
  }

  /**
   * Frames a dissection step: the preset supplies the viewing direction and a floor on the
   * field of view, the bounding box of the structures to find supplies the centre and size.
   * This keeps every structure on screen instead of trusting hand-tuned zoom values.
   */
  frameStep(viewName: string, items: RT[], dur?: number) {
    const v = this.views[viewName]; if (!v) throw new Error(`unknown view ${viewName}`);
    const dir = V(v.d[0], v.d[1], v.d[2]).normalize();
    const box = this.boxOf(items);
    if (!box) { this.framePreset(viewName, dur); return; }
    const presetC = V(v.c[0], v.c[1], v.c[2]);
    const c = box.getCenter(new Vector3()).lerp(presetC, 0.25);
    const sz = box.getSize(new Vector3());
    // Project the box extent onto the screen axes for this direction.
    const up = new Vector3(0, 1, 0), right = new Vector3().crossVectors(up, dir).normalize(), upS = new Vector3().crossVectors(dir, right).normalize();
    const ext = (axis: Vector3) => Math.abs(axis.x) * sz.x + Math.abs(axis.y) * sz.y + Math.abs(axis.z) * sz.z;
    const w = Math.max(v.w * 0.75, ext(right) + 4), h = Math.max(v.h * 0.75, ext(upS) + 4);
    this.flyTo(c, c.clone().add(dir.multiplyScalar(this.fitDistance(w, h))), dur);
  }

  centreOn(pt: Vector3) { const off = this.camera.position.clone().sub(this.controls.target); this.flyTo(pt, pt.clone().add(off), 600); }

  /** Advances the fly animation; returns true if the camera moved. */
  tick(now: number): boolean {
    let moved = false;
    if (this.fly) {
      const f = this.fly; let k = (now - f.t0) / f.dur; if (k >= 1) k = 1;
      const e = ease(k);
      this.controls.target.lerpVectors(f.ft, f.tt, e); this.camera.position.lerpVectors(f.fp, f.tp, e);
      if (k >= 1) this.fly = null; moved = true;
    }
    this.controls.update();
    return moved;
  }
  cancelFly() { this.fly = null; }
}
