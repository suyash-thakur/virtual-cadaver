/**
 * Texture-space cutting for the skin layers.
 *
 * Instead of hiding whole vertices (which gives stair-stepped holes the size of the mesh's
 * triangles), each shell carries a mask texture painted in world-space planar projections:
 * three faces (X, Y, Z) side by side in one atlas. A fragment picks the face by its
 * dominant normal, looks up the texel at its projected position and discards itself when
 * that texel is marked removed. The texel also stores the depth along the projection axis,
 * so the front and back of the body, or the chest and the arm, never share a cut.
 *
 * Channels: R removed, G incision line, B depth along the axis (0..1 over the box).
 * A per-face depth map of the body surface (rendered once) bounds the flap fills.
 */
import { DataTexture, LinearFilter, Mesh, OrthographicCamera, RGBAFormat, Scene, ShaderMaterial, UnsignedByteType, Vector3, WebGLRenderTarget, WebGLRenderer, DoubleSide, type BufferGeometry, Box3 } from 'three';

export const FACE = 768;
export const ATLAS_W = FACE * 3;
export type FaceId = 0 | 1 | 2; // X, Y, Z
/** Depth tolerance along the projection axis, as a fraction of the box size. Mirrored in the shader. */
export const DEPTH_TOL = 0.03;

export interface Projected { face: FaceId; u: number; v: number; d: number }

/** The box the masks cover and the body's depth maps, shared by all shells. */
export class MaskSpace {
  min = new Vector3(); size = new Vector3();
  /** Nearest surface depth seen from the + side and from the − side of each face, 0..255; 255 = nothing. */
  near: Uint8Array[] = []; far: Uint8Array[] = [];
  /** Number of occupied texels per face (either side). */
  occupied = [0, 0, 0];

  constructor(geo: BufferGeometry) {
    geo.computeBoundingBox(); const b = geo.boundingBox!.clone().expandByScalar(1.5);
    this.min.copy(b.min); this.size.copy(b.max).sub(b.min);
  }

  faceOf(n: { x: number; y: number; z: number }): FaceId {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (az >= 0.35) return 2;
    return ax >= ay ? 0 : 1;
  }
  project(face: FaceId, p: Vector3): Projected {
    const q = p.clone().sub(this.min).divide(this.size);
    if (face === 2) return { face, u: q.x, v: q.y, d: q.z };
    if (face === 0) return { face, u: q.y, v: q.z, d: q.x };
    return { face, u: q.x, v: q.z, d: q.y };
  }
  /** World units per texel along u and v of a face. */
  texel(face: FaceId): [number, number] {
    const s = this.size;
    if (face === 2) return [s.x / FACE, s.y / FACE];
    if (face === 0) return [s.y / FACE, s.z / FACE];
    return [s.x / FACE, s.z / FACE];
  }

  /** Renders the body surface depth for each face from both sides. */
  buildDepth(renderer: WebGLRenderer, mesh: Mesh): void {
    const scene = new Scene(); const probe = new Mesh(mesh.geometry); scene.add(probe);
    const mat = new ShaderMaterial({ side: DoubleSide, uniforms: { uAxis: { value: 0 }, uMin: { value: this.min }, uSize: { value: this.size } },
      vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform int uAxis; uniform vec3 uMin; uniform vec3 uSize; varying vec3 vW; void main(){ vec3 q = (vW - uMin) / uSize; float d = uAxis == 0 ? q.x : (uAxis == 1 ? q.y : q.z); gl_FragColor = vec4(d, d, d, 1.0); }' });
    probe.material = mat;
    const rt = new WebGLRenderTarget(FACE, FACE, { depthBuffer: true });
    const px = new Uint8Array(FACE * FACE * 4);
    const c = this.min.clone().addScaledVector(this.size, 0.5);
    const prevTarget = renderer.getRenderTarget(), prevClear = renderer.getClearAlpha();
    const render = (face: FaceId, sign: 1 | -1): Uint8Array => {
      mat.uniforms.uAxis.value = face;
      const s = this.size; const ext = sign * (face === 0 ? s.x : face === 1 ? s.y : s.z);
      const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      let hw: number, hh: number, up: Vector3, flipU = false;
      if (face === 2) { hw = s.x / 2; hh = s.y / 2; up = new Vector3(0, 1, 0); cam.position.set(c.x, c.y, c.z + ext); flipU = sign < 0; }
      else if (face === 0) { hw = s.y / 2; hh = s.z / 2; up = new Vector3(0, 0, 1); cam.position.set(c.x + ext, c.y, c.z); flipU = sign < 0; }
      else { hw = s.x / 2; hh = s.z / 2; up = new Vector3(0, 0, 1); cam.position.set(c.x, c.y + ext, c.z); flipU = sign > 0; }
      cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh; cam.near = 0.1; cam.far = Math.abs(ext) * 2 + 1;
      cam.up.copy(up); cam.lookAt(c); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, FACE, FACE, px);
      const out = new Uint8Array(FACE * FACE).fill(255);
      for (let j = 0; j < FACE; j++) for (let i = 0; i < FACE; i++) {
        const k = (j * FACE + i) * 4; if (px[k + 3] === 0) continue;
        const ii = flipU ? FACE - 1 - i : i; out[j * FACE + ii] = px[k];
      }
      return out;
    };
    for (const f of [0, 1, 2] as FaceId[]) {
      this.near[f] = render(f, 1); this.far[f] = render(f, -1);
      let n = 0; for (let k = 0; k < FACE * FACE; k++) if (this.near[f][k] !== 255) n++; this.occupied[f] = n;
    }
    renderer.setRenderTarget(prevTarget); renderer.setClearColor(0x000000, prevClear);
    rt.dispose(); mat.dispose();
  }
}

type Op = { kind: 'stamp'; channel: 'cut' | 'line'; r: number; pts: Vector3[] } | { kind: 'fill'; p: Vector3; n: Vector3 };

/** One shell's mask: the atlas texture, CPU copy, and an operation log for undo. */
export class CutMask {
  data = new Uint8Array(ATLAS_W * FACE * 4);
  tex: DataTexture;
  dirty = false;
  private ops: Op[] = [];

  constructor(public space: MaskSpace) {
    this.tex = new DataTexture(this.data, ATLAS_W, FACE, RGBAFormat, UnsignedByteType);
    this.tex.minFilter = LinearFilter; this.tex.magFilter = LinearFilter; this.tex.generateMipmaps = false; this.tex.flipY = false; this.tex.needsUpdate = true;
  }
  get opCount() { return this.ops.length; }

  private idx(face: FaceId, i: number, j: number) { return (j * ATLAS_W + face * FACE + i) * 4; }

  /** Paints a disc of radius r (world units) around p into every face, storing p's depth. */
  private stampOne(p: Vector3, r: number, channel: 'cut' | 'line') {
    const ch = channel === 'cut' ? 0 : 1;
    for (const face of [0, 1, 2] as FaceId[]) {
      const pr = this.space.project(face, p); const [tu, tv] = this.space.texel(face);
      const cu = pr.u * FACE, cv = pr.v * FACE, ru = r / tu, rv = r / tv;
      const i0 = Math.max(0, Math.floor(cu - ru)), i1 = Math.min(FACE - 1, Math.ceil(cu + ru)), j0 = Math.max(0, Math.floor(cv - rv)), j1 = Math.min(FACE - 1, Math.ceil(cv + rv));
      const dByte = Math.max(0, Math.min(255, Math.round(pr.d * 255)));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const du = (i + 0.5 - cu) / ru, dv = (j + 0.5 - cv) / rv; if (du * du + dv * dv > 1) continue;
        const k = this.idx(face, i, j);
        // Keep the depth of the first mark unless this is a fresh texel or the depths agree.
        if (this.data[k] === 0 && this.data[k + 1] === 0) this.data[k + 2] = dByte;
        else if (Math.abs(this.data[k + 2] - dByte) > DEPTH_TOL * 255) continue;
        this.data[k + ch] = 255;
      }
    }
    this.dirty = true;
  }

  /** Stamps along a stroke so fast pointer moves leave no gaps. */
  stroke(pts: Vector3[], r: number, channel: 'cut' | 'line', record = true) {
    const all: Vector3[] = [];
    for (let k = 0; k < pts.length; k++) {
      if (k > 0) { const a = pts[k - 1], b = pts[k]; const dist = a.distanceTo(b); const steps = Math.min(60, Math.ceil(dist / (r * 0.6))); for (let s = 1; s < steps; s++) all.push(a.clone().lerp(b, s / steps)); }
      all.push(pts[k]);
    }
    for (const p of all) this.stampOne(p, r, channel);
    if (record) { const last = this.ops[this.ops.length - 1]; if (last && last.kind === 'stamp' && last.channel === channel && last.r === r && last.pts.length < 4000) last.pts.push(...pts); else this.ops.push({ kind: 'stamp', channel, r, pts: pts.slice() }); }
  }
  /** Starts a new stroke op so the next stroke is a separate undo step. */
  endStroke() { this.ops.push({ kind: 'stamp', channel: 'line', r: 0, pts: [] }); }

  /**
   * Flood-fills the region of the surface around p bounded by incision lines (and by the
   * edges of the surface in this projection). Returns the number of texels removed, or -1
   * when the region is unbounded (the user has not outlined a flap).
   */
  fill(p: Vector3, n: Vector3, record = true): number {
    const face = this.space.faceOf(n); const pr = this.space.project(face, p);
    const si = Math.min(FACE - 1, Math.max(0, Math.floor(pr.u * FACE))), sj = Math.min(FACE - 1, Math.max(0, Math.floor(pr.v * FACE)));
    const d0 = pr.d * 255; const nearD = this.space.near[face], farD = this.space.far[face];
    const seedN = nearD[sj * FACE + si], seedF = farD[sj * FACE + si];
    const D = Math.abs(seedN - d0) <= Math.abs(seedF - d0) ? nearD : farD;
    if (D[sj * FACE + si] === 255) return 0;
    const seen = new Uint8Array(FACE * FACE); const stack = [si, sj]; const region: number[] = []; const limit = Math.max(50, this.space.occupied[face] * 0.3);
    seen[sj * FACE + si] = 1;
    while (stack.length) {
      const j = stack.pop()!, i = stack.pop()!; const k = this.idx(face, i, j), kd = j * FACE + i;
      if (this.data[k + 1] > 127 && Math.abs(this.data[k + 2] - D[kd]) <= DEPTH_TOL * 255) continue; // incision line bounds the flap
      if (this.data[k] > 127 && Math.abs(this.data[k + 2] - D[kd]) <= DEPTH_TOL * 255) continue;    // already removed
      region.push(i, j); if (region.length / 2 > limit) return -1;
      const dk = D[kd];
      for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (ni < 0 || nj < 0 || ni >= FACE || nj >= FACE) continue; const nk = nj * FACE + ni; if (seen[nk]) continue; seen[nk] = 1;
        const nd = D[nk]; if (nd === 255 || Math.abs(nd - dk) > 4) continue; // off the surface or a depth jump
        stack.push(ni, nj);
      }
    }
    for (let q = 0; q < region.length; q += 2) { const i = region[q], j = region[q + 1]; const k = this.idx(face, i, j); this.data[k] = 255; this.data[k + 2] = D[j * FACE + i]; }
    this.dirty = true;
    if (record) this.ops.push({ kind: 'fill', p: p.clone(), n: n.clone() });
    return region.length / 2;
  }

  /** CPU-side test for picking: is the surface at p (normal n) removed? */
  isRemoved(p: Vector3, n: Vector3): boolean {
    const face = this.space.faceOf(n); const pr = this.space.project(face, p);
    const i = Math.min(FACE - 1, Math.max(0, Math.floor(pr.u * FACE))), j = Math.min(FACE - 1, Math.max(0, Math.floor(pr.v * FACE)));
    const k = this.idx(face, i, j);
    return this.data[k] > 127 && Math.abs(this.data[k + 2] / 255 - pr.d) < DEPTH_TOL;
  }

  /** True when an incision line has been drawn at p on any face (depth-checked). */
  hasLineAt(p: Vector3): boolean {
    for (const face of [0, 1, 2] as FaceId[]) {
      const pr = this.space.project(face, p);
      const i = Math.min(FACE - 1, Math.max(0, Math.floor(pr.u * FACE))), j = Math.min(FACE - 1, Math.max(0, Math.floor(pr.v * FACE)));
      const k = this.idx(face, i, j);
      if (this.data[k + 1] > 127 && Math.abs(this.data[k + 2] / 255 - pr.d) < DEPTH_TOL) return true;
    }
    return false;
  }

  /** Undoes the last operation by replaying the log. */
  undo(): boolean {
    const empty = () => { const t = this.ops[this.ops.length - 1]; return !!t && t.kind === 'stamp' && t.pts.length === 0; };
    while (empty()) this.ops.pop();
    if (!this.ops.length) return false;
    this.ops.pop(); while (empty()) this.ops.pop();
    const ops = this.ops; this.ops = []; this.data.fill(0);
    for (const op of ops) { if (op.kind === 'stamp') { if (op.pts.length) this.stroke(op.pts, op.r, op.channel, false); this.ops.push(op); } else { this.fill(op.p, op.n, false); this.ops.push(op); } }
    this.dirty = true; return true;
  }
  clear() { this.ops = []; this.data.fill(0); this.dirty = true; }
  /** Uploads the texture if anything changed; call once per frame. */
  flush() { if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; } }
}
