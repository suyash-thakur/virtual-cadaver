import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Raycaster, Scene, TubeGeometry, Vector3 } from 'three';
import type { Content, Structure, Other, Nerve, Layer } from '../content';
import { V, v3, armL, armDir, DEG } from './coords';
import { curveOf, sphereGeo, fibreTex, roughen, sheetGeo, plateGeo, deltoidGeo, fatPadGeo } from './geometry/builders';
import { CENTER } from './coords';
import { ensureBVH } from './bvh';
import { buildShells, decorateShell, SkinProjector } from './body';
import { bodyTextures } from './textures';
import { pendingPositions } from './assets';
import { CutMask, MaskSpace } from './cutmask';
import type { WebGLRenderer } from 'three';
import { collectSplats, proj as fieldProj, type Field } from './geometry/body';
import type { BodyRequest, BodyResponse } from './geometry/body.worker';
import { makeMat, peelMaterial } from './materials';
import { Registry, type RT } from './registry';

export type PaletteMode = 'cadaver' | 'cord' | 'classic';

const hitMat = new MeshBasicMaterial({ visible: false });
const tmpA = new Vector3(), tmpB = new Vector3();

/** Builds and owns every mesh of the specimen. Visibility, colour and fold state are applied here. */
export class Specimen {
  R = new Registry();
  built = false;
  field: Field | null = null;
  palette: PaletteMode = 'cadaver';
  private texSheet = fibreTex(true, 3); private texTube = fibreTex(false, 5); private texNerve = fibreTex(false, 7);

  constructor(public C: Content, public scene: Scene, private labelsEl: HTMLElement, private onLabel: (id: string) => void) {
    this.texSheet.repeat.set(5, 1); this.texTube.repeat.set(2, 1); this.texNerve.repeat.set(6, 1);
    for (const st of C.structures) { if (st.layer === 'nerves') this.buildNerve(st); else this.buildOther(st); }
    for (const n of C.nerves) this.R.get(n.id).children = n.children.slice();
  }

  get S() { return this.R.S; }
  get order() { return this.R.order; }

  colorFor(d: RT): string {
    if (d.layer === 'nerves') { const p = this.palette; return p === 'cord' ? this.C.palette.families[d.fam!].c : (p === 'classic' ? this.C.palette.classicNerve : this.C.palette.cadaverNerve); }
    return this.palette === 'cadaver' ? (d.cad || d.color) : d.color;
  }
  /** Colour for swatches and chips: nerves keep their family colour even in cadaver mode. */
  dotColor(d: RT): string { return d.layer === 'nerves' && this.palette === 'cadaver' ? this.C.palette.families[d.fam!].c : this.colorFor(d); }

  private register(partial: Omit<RT, 'meshes' | 'hits' | 'cov' | 'cur' | 'target' | 'eBase' | 'lbl' | 'foldCur' | 'lift' | 'children' | 'parents'> & { parents?: string[]; lift?: number }): RT {
    const b = document.createElement('button'); b.className = 'lbl'; b.type = 'button'; b.hidden = true;
    b.textContent = partial.label || partial.name; b.addEventListener('click', () => this.onLabel(partial.id));
    this.labelsEl.appendChild(b);
    const d: RT = { ...partial, parents: partial.parents || [], children: [], meshes: [], hits: [], cov: [], cur: 1, target: 1, eBase: 0, lbl: b, foldCur: 0, lift: 0 };
    this.R.add(d); return d;
  }
  private addMesh(d: RT, geo: BufferGeometry, pos?: Vector3): Mesh {
    ensureBVH(geo);
    const m = new Mesh(geo, d.mat); if (pos) m.position.copy(pos);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.sid = d.id; this.scene.add(m); d.meshes.push(m); return m;
  }

  private buildNerve(n: Nerve) {
    const d = this.register({ id: n.id, name: n.name, label: n.label, kind: n.kind, layer: 'nerves', info: n.info, key: n.key, fam: n.fam, roots: n.roots, parents: n.parents, op: 1, color: '', mat: makeMat('#fff', 1, false), anchor: new Vector3() });
    d.mat.color.set(this.colorFor(d)); d.mat.roughness = .42; d.eBase = .07;
    d.mat.map = this.texNerve; d.mat.bumpMap = this.texNerve; d.mat.bumpScale = .25; (d.mat as any).clearcoat = .25; (d.mat as any).clearcoatRoughness = .5;
    d.tubeDefs = n.paths.map((pts, pi) => { const r = n.r * (pi ? 0.8 : 1); return { pts: pts.map(v3), r, caps: true, hit: true, nerve: true, rough: r * .14, freq: 1.6 }; });
    d.tubeOnly = true; d.anchorU = n.lu == null ? .5 : n.lu;
    this.buildTubeMeshes(d);
  }

  /** Builds (or rebuilds) a structure's meshes from its tube definitions. */
  private buildTubeMeshes(d: RT) {
    d.tubeDefs!.forEach((t, pi) => {
      const c = curveOf(t.pts);
      const seg = Math.max(14, Math.round(c.getLength() * (t.nerve ? 3.4 : 3)));
      this.addMesh(d, roughen(new TubeGeometry(c, seg, t.r, t.open ? 20 : (t.nerve ? 10 : 12), false), t.rough, t.freq));
      if (t.caps) [t.pts[0], t.pts[t.pts.length - 1]].forEach(p => { const s = this.addMesh(d, sphereGeo, p); s.scale.setScalar(t.r); });
      if (t.hit) { const hitGeo = new TubeGeometry(c, Math.max(8, Math.round(seg / 2)), Math.max(t.r * 2.6, .75), 6, false); ensureBVH(hitGeo, 100);
        const hm = new Mesh(hitGeo, hitMat); hm.userData.sid = d.id; this.scene.add(hm); d.hits.push(hm); }
      d.cov.push({ curve: c, r: t.r });
      if (pi === 0 || !d.curve) d.curve = c;
    });
    if (d.anchorU != null && d.curve) d.anchor = d.curve.getPoint(d.anchorU);
  }

  /**
   * Content splines were authored against the old procedural body. Any tube control point
   * that lies outside the real skin is moved just under the nearest skin surface and the
   * tubes are rebuilt. Returns the ids that moved.
   */
  conformToSkin(): string[] {
    const skinMesh = this.R.S.skin?.meshes[0]; if (!skinMesh) return [];
    const bvh = (skinMesh.geometry as unknown as { boundsTree?: { closestPointToPoint: (p: Vector3, t: { point: Vector3; distance: number; faceIndex: number }) => unknown } }).boundsTree; if (!bvh) return [];
    const target = { point: new Vector3(), distance: 0, faceIndex: 0 };
    const pos = skinMesh.geometry.attributes.position, idx = skinMesh.geometry.index!;
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), tmp = new Vector3();
    const faceNormal = (faceIndex: number) => { const f = faceIndex * 3; a.fromBufferAttribute(pos, idx.getX(f)); b.fromBufferAttribute(pos, idx.getX(f + 1)); c.fromBufferAttribute(pos, idx.getX(f + 2)); return n.crossVectors(b.sub(a), c.sub(a)).normalize(); };
    // Inside test by ray parity along three axes, majority vote: a single ray can slip through the
    // small holes of the reduced skin mesh (eyes, open clip loops); a nearest-normal test fails in
    // concave regions such as the axilla.
    const ray = new Raycaster(); const dirs = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
    const inside = (p: Vector3) => { let votes = 0; for (const dir of dirs) { ray.set(p, dir); ray.far = 500; if (ray.intersectObject(skinMesh, false).length & 1) votes++; } return votes >= 2; };
    // A tube also pokes out when its centreline runs inside but shallower than its radius.
    const covered = (p: Vector3, r: number) => inside(p) && (bvh.closestPointToPoint(p, target), target.distance >= r + 0.45);
    void tmp;
    const moved: string[] = [];
    for (const d of this.order) {
      if (!d.tubeDefs || d.real || !d.tubeOnly || d.id === 'incisions') continue;
      let changed = false;
      const tuck = (p: Vector3, r: number) => { bvh.closestPointToPoint(p, target); faceNormal(target.faceIndex); p.copy(target.point).addScaledVector(n, -(r + 0.7)); };
      for (const t of d.tubeDefs) {
        for (const p of t.pts) if (!covered(p, t.r)) { tuck(p, t.r); changed = true; }
        // The curve between control points can still bow out through concave skin (neck, axilla):
        // sample it and insert tucked points where it does, a few rounds.
        for (let round = 0; round < 3 && t.pts.length < 60; round++) {
          const curve = curveOf(t.pts); const samples = 48; let inserted = 0;
          for (let s = 1; s < samples; s++) {
            const u = s / samples; const q = curve.getPoint(u); if (covered(q, t.r)) continue;
            // insert after the last control point whose curve parameter precedes u
            const k = Math.min(t.pts.length - 2, Math.floor(u * (t.pts.length - 1)));
            tuck(q, t.r); t.pts.splice(k + 1, 0, q); inserted++; changed = true;
            if (t.pts.length >= 60) break;
          }
          if (!inserted) break;
        }
      }
      if (!changed) continue;
      for (const m of d.meshes) { this.scene.remove(m); m.geometry.dispose(); }
      for (const h of d.hits) { this.scene.remove(h); h.geometry.dispose(); }
      d.meshes = []; d.hits = []; d.cov = []; d.curve = undefined;
      this.buildTubeMeshes(d); moved.push(d.id);
    }
    return moved;
  }

  private buildOther(o: Other) {
    const double = !!(o.sheet || o.plate || o.custom || (o.tubes && o.tubes.some(t => t.open)));
    const d = this.register({ id: o.id, name: o.name, label: o.label, kind: o.kind, layer: o.layer, info: o.info, landmark: o.landmark, noCover: o.noCover, fold: o.fold, op: o.op, color: o.color, cad: o.cad, mat: makeMat('#fff', o.op, double), anchor: v3(o.anchor) });
    const m = d.mat as any;
    m.color.set(this.colorFor(d));
    m.roughness = o.layer === 'vessels' ? .35 : (o.layer === 'bones' ? .8 : .65);
    d.eBase = o.layer === 'bones' ? .14 : .05;
    if (o.kind === 'Muscle') { m.map = (o.sheet || o.custom) ? this.texSheet : this.texTube; m.bumpMap = m.map; m.bumpScale = .35; m.clearcoat = .3; m.clearcoatRoughness = .5; }
    if (o.layer === 'vessels') { m.clearcoat = .55; m.clearcoatRoughness = .35; }
    if (o.kind === 'Fascia') { m.clearcoat = .9; m.clearcoatRoughness = .25; m.roughness = .3; m.depthWrite = false; }
    if (o.custom === 'fatpad') { m.roughness = .55; m.clearcoat = .4; m.clearcoatRoughness = .4; }
    if (o.tubes && o.tubes.length) {
      d.tubeDefs = o.tubes.map(t => ({ pts: t.pts.map(v3), r: t.r, caps: !!t.caps, open: !!t.open, rough: o.kind === 'Muscle' ? .09 : (o.layer === 'vessels' ? .03 : 0), freq: 0.9 }));
      d.tubeOnly = !(o.spheres || o.boxes || o.cyls || o.sheet || o.plate || o.custom);
      this.buildTubeMeshes(d);
    }
    (o.spheres || []).forEach(s => { const c = v3(s.c); const mm = this.addMesh(d, sphereGeo, c); mm.scale.setScalar(s.r); d.cov.push({ pt: c, r: s.r }); });
    (o.boxes || []).forEach(b => { const c = v3(b.c); this.addMesh(d, new BoxGeometry(b.s[0], b.s[1], b.s[2]), c);
      for (let y = -b.s[1] / 2; y <= b.s[1] / 2; y += .8) d.cov.push({ pt: c.clone().add(new Vector3(0, y, 0)), r: Math.max(b.s[0], b.s[2]) / 2 }); });
    (o.cyls || []).forEach(b => { const c = v3(b.c); this.addMesh(d, new CylinderGeometry(b.r, b.r, b.h, 18), c); d.cov.push({ pt: c, r: b.r }); });
    if (o.sheet) { const sg = sheetGeo(o.sheet.o.map(v3), o.sheet.i.map(v3), o.sheet.bulge, o.sheet.bdir); d.sg = sg; this.addMesh(d, sg.g); d.cov.push({ arr: sg.base, r: .3 }); }
    if (o.plate) { const pg = plateGeo(o.plate.c, o.plate.ring, o.plate.shrink, o.plate.dz); this.addMesh(d, pg.g); pg.pts.forEach(p => d.cov.push({ pt: p, r: .3 })); }
    if (o.custom === 'fatpad') this.addMesh(d, fatPadGeo());
    if (o.custom === 'deltoid') { const dg = deltoidGeo(); d.dg = dg; this.addMesh(d, dg.g); d.cov.push({ arr: dg.base, r: .35 }); }
  }

  /** Muscle reflection: rotates the sheet about an axis through its insertion. */
  applyFold(d: RT) {
    const f = d.foldCur, mesh = d.meshes[d.meshes.length - 1], posA = mesh.geometry.attributes.position;
    if (d.sg) {
      const sg = d.sg, axis = new Vector3().subVectors(sg.oc, sg.ic).cross(new Vector3(0, 0, 1)).normalize();
      if (d.foldSign == null) { const probe = sg.oc.clone().sub(sg.ic).applyAxisAngle(axis, .2).add(sg.ic); d.foldSign = probe.z > sg.oc.z ? 1 : -1; }
      const ang = f * (d.fold || 0) * d.foldSign;
      for (let a = 0; a <= sg.nu; a++) { const I = sg.ins[a];
        for (let b = 0; b <= sg.nv; b++) { const k = (a * (sg.nv + 1) + b) * 3;
          tmpA.set(sg.base[k], sg.base[k + 1], sg.base[k + 2]).sub(I).applyAxisAngle(axis, ang).add(I);
          posA.setXYZ(k / 3, tmpA.x, tmpA.y, tmpA.z); } }
    } else if (d.dg) {
      const dg = d.dg, D = V(0.643, -0.766, 0).normalize();
      if (d.foldSign == null) { const r0 = dg.rad[0];
        const ax = new Vector3().crossVectors(D, r0).normalize();
        const p0 = tmpA.set(dg.base[0], dg.base[1], dg.base[2]); const moved = p0.clone().sub(dg.ins).applyAxisAngle(ax, .2).add(dg.ins);
        d.foldSign = moved.sub(p0).dot(r0) > 0 ? 1 : -1; }
      for (let k = 0; k < dg.rad.length; k++) { const ax = tmpB.crossVectors(D, dg.rad[k]).normalize();
        tmpA.set(dg.base[k * 3], dg.base[k * 3 + 1], dg.base[k * 3 + 2]).sub(dg.ins).applyAxisAngle(ax, f * (d.fold || 0) * d.foldSign).add(dg.ins);
        posA.setXYZ(k, tmpA.x, tmpA.y, tmpA.z); }
    } else if (d.rig) {
      const r = d.rig, ang = f * (d.fold || 0);
      for (let k = 0; k < r.base.length; k += 3) {
        tmpA.set(r.base[k], r.base[k + 1], r.base[k + 2]).sub(r.pivot);
        const along = tmpA.dot(r.dir), w = Math.min(1, Math.max(0, along / r.span)); const ww = w * w * (3 - 2 * w);
        tmpA.applyAxisAngle(r.axis, ang * ww).add(r.pivot);
        posA.setXYZ(k / 3, tmpA.x, tmpA.y, tmpA.z);
      }
    } else return;
    posA.needsUpdate = true; mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere();
  }

  applyVis(d: RT) {
    const lift = d.lift || 0, o = d.cur * d.op * (1 - lift), m = d.mat, tr = o < .995;
    // A detached muscle drifts off its bed as it fades, so the removal reads as lifting it away.
    if (d.liftDir) for (const x of d.meshes) x.position.copy(d.liftDir).multiplyScalar(lift * 2.5);
    m.opacity = o;
    if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
    if (d.kind !== 'Fascia' && d.id !== 'deepFascia') m.depthWrite = o > .5;
    const vis = o > .015;
    d.meshes.forEach(x => { if (!x.userData.inc) x.visible = vis; });
  }

  applyColors(override: (d: RT) => string | null) {
    for (const d of this.order) d.mat.color.set(override(d) || this.colorFor(d));
  }

  /** Sets the peel uniforms of the three shells and the drawn length of the incisions. */
  applyDissect(skin: [number, number], fat: [number, number], fascia: [number, number], inc: number, fold: Record<string, number>) {
    if (this.built) {
      const set = (id: string, c: [number, number]) => { const u = this.R.get(id).peel!; u.uCutT.value = c[0]; u.uCutA.value = c[1]; };
      set('skin', skin); set('fat', fat); set('deepFascia', fascia);
      const incD = this.R.S.incisions;
      if (incD) { const tubes = incD.meshes.filter(m => m.userData.inc), n = tubes.length;
        tubes.forEach((m, k) => { const p = Math.max(0, Math.min(1, inc * n - k)); const cnt = m.geometry.index!.count; m.geometry.setDrawRange(0, Math.floor(cnt * p / 6) * 6); }); }
    }
    for (const id of Object.keys(fold)) { const d = this.R.S[id]; if (!d || d.lift === fold[id]) continue;
      d.lift = fold[id];
      if (!d.liftDir) { d.liftDir = d.anchor.clone().sub(CENTER).setY(0).normalize().add(new Vector3(0, 0.3, 0.6)).normalize(); }
      this.applyVis(d); }
  }

  /** Meshes that can hide a label anchor: visible, mostly opaque, not nerves' hit tubes. */
  occluders(): Mesh[] {
    const out: Mesh[] = [];
    for (const d of this.order) if (d.cur * d.op > .6) for (const m of d.meshes) if (m.visible) out.push(m);
    return out;
  }

  /** Builds the skin layers in a worker, then the structures that sit on them. Resolves when done. */
  /** True when the shells come from the real skin mesh rather than the field. */
  realBody = false;
  /** Surface query used to place helpers on the body; exposed for diagnostics. */
  projector: { proj: (st: number[], dir: number[], iso: number) => number[] | null } | null = null;

  async buildBody(realSkin?: BufferGeometry): Promise<void> {
    const geos: Record<string, BufferGeometry> = {};
    let projector: { proj: (st: number[], dir: number[], iso: number) => number[] | null };
    if (realSkin) {
      const samples = this.order.filter(d => d.real).flatMap(d => d.meshes.map(m => m.geometry.attributes.position.array as Float32Array)).concat(pendingPositions());
      const shells = buildShells(realSkin, samples);
      geos.skin = shells.skin; geos.fat = shells.fat; geos.deepFascia = shells.deepFascia;
      for (const sh of this.C.shells) decorateShell(geos[sh.id], sh.tone);
      const sp = new SkinProjector(shells.skin);
      projector = { proj: (st, dir, iso) => sp.proj(st, dir, iso) };
      this.realBody = true;
    } else {
      const splats = collectSplats(this.order);
      const worker = new Worker(new URL('./geometry/body.worker.ts', import.meta.url), { type: 'module' });
      const req: BodyRequest = { splats, h: 0.45, shells: this.C.shells.map(s => ({ id: s.id, iso: s.iso, tone: s.tone })) };
      const res = await new Promise<BodyResponse>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<BodyResponse>) => resolve(e.data);
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage(req);
      });
      worker.terminate();
      this.field = res.field;
      const G = this.field;
      projector = { proj: (st, dir, iso) => fieldProj(G, st, dir, iso) };
      for (const sh of this.C.shells) {
        const m = res.shells.find(x => x.id === sh.id)!;
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(m.pos, 3)); g.setAttribute('peel', new BufferAttribute(m.peel, 1));
        g.setAttribute('warm', new BufferAttribute(m.warm, 1)); g.setAttribute('color', new BufferAttribute(m.col, 3));
        g.setIndex(new BufferAttribute(m.idx, 1)); g.computeVertexNormals();
        geos[sh.id] = g;
      }
    }
    this.projector = projector;
    const tex = this.realBody ? bodyTextures() : null;
    for (const sh of this.C.shells) {
      const g = geos[sh.id];
      const inf = this.C.surfaces[sh.id];
      const d = this.register({ id: sh.id, name: inf.name, kind: inf.kind, info: inf.info, layer: 'skin', noCover: true, surface: true, color: sh.color, cad: sh.cad, op: sh.op, shellKey: sh.key, mat: makeMat('#fff', 1, true), anchor: new Vector3() });
      const pm = peelMaterial(this.colorFor(d), sh.rough, sh.op, sh.inner, tex ? tex[sh.id] : undefined); d.mat = pm.mat; d.peel = pm.u; d.eBase = 0;
      if (sh.op < 1) d.mat.depthWrite = false;
      const mesh = this.addMesh(d, g); mesh.userData.shell = true; mesh.renderOrder = sh.op < 1 ? 2 : 0;
    }
    // Surface queries below go through the projector so the helpers sit on whichever body was built.
    // Rays start well outside either body (the real chest front lies about 10 units anterior).
    const frontPt = (_G: unknown, l: number, s: number, iso: number) => projector.proj([l, s, 34], [0, 0, -1], iso);
    const armPt = (_G: unknown, t: number, th: number, iso: number) => { const ax = armL(t, 0, -1.2), dd = armDir(th); return projector.proj([ax[0] + dd[0] * 16, ax[1] + dd[1] * 16, ax[2] + dd[2] * 16], [-dd[0], -dd[1], -dd[2]], iso); };
    const proj = (_G: unknown, st: number[], dir: number[], iso: number) => projector.proj(st, dir, iso);
    const G = null;
    const toV = (q: number[] | null) => q ? V(q[0], q[1], q[2]) : null;
    const S = this.R.S;
    S.skin.anchor = toV(frontPt(G, 6, -5, 0)) || V(6, -5, 7);
    S.fat.anchor = toV(frontPt(G, 6, -6, -.45)) || V(6, -6, 7);
    S.deepFascia.anchor = toV(frontPt(G, 6, -7, -1)) || V(6, -7, 6);

    const P = this.C.palette;
    const addSurface = (id: string, extra: Partial<RT> & { color: string; op: number }) => {
      const inf = this.C.surfaces[id];
      return this.register({ id, name: inf.name, kind: inf.kind, info: inf.info, layer: 'skin', noCover: true, surface: true, mat: makeMat('#fff', 1, false), anchor: new Vector3(), ...extra });
    };
    const tubeStruct = (id: string, paths: (Vector3 | null)[][], r: number, color: string, cad: string) => {
      const d = addSurface(id, { color, cad, op: 1 });
      d.mat.color.set(this.colorFor(d)); d.mat.roughness = .45; d.eBase = .05;
      d.tubeDefs = paths.map(pts => pts.filter((x): x is Vector3 => !!x)).filter(q => q.length >= 2).map(q => ({ pts: q, r, caps: true, rough: 0, freq: 0.9 }));
      d.tubeOnly = true; d.anchorU = .5;
      if (d.tubeDefs.length) this.buildTubeMeshes(d);
      return d;
    };
    const ap = (t: number, th: number, iso: number) => toV(armPt(G, t, th, iso));
    const fp = (l: number, s: number, iso: number) => toV(frontPt(G, l, s, iso));
    const A = (t: number, n: number, z: number) => { const q = armL(t, n, z); return V(q[0], q[1], q[2]); };
    tubeStruct('cephalicV', [[ap(18, 72 * DEG, -.75), ap(13, 72 * DEG, -.75), ap(8, 74 * DEG, -.75), ap(3, 78 * DEG, -.8), ap(-0.5, 82 * DEG, -.85), fp(13.6, 2.6, -.85), V(11.4, 2.3, 2.7), V(10.1, 1.8, 2.1), V(9.2, 1.6, 1.8)]], .3, P.vein, P.veinCadaver);
    tubeStruct('basilicV', [[ap(26, 150 * DEG, -.75), ap(20, 152 * DEG, -.75), ap(15, 156 * DEG, -.8), A(12, 4.5, 0.75), A(10, 4.5, 0.7)]], .3, P.vein, P.veinCadaver);
    tubeStruct('ejv', [[fp(3.6, 13.2, -.7), fp(4.4, 11.4, -.65), fp(5.2, 8.6, -.65), fp(5.7, 6.2, -1.3), V(6.1, 4.0, 2.3), V(6.2, 3.2, 2.2)]], .27, P.vein, P.veinCadaver);
    const sc = (l1: number, s1: number, iso: number) => { const out: (Vector3 | null)[] = []; for (let k = 0; k <= 9; k++) { const f = k / 9; out.push(fp(4.9 + (l1 - 4.9) * f, 10 + (s1 - 10) * f, -1.15 + (iso + 1.15) * f)); } return out; };
    const scd = tubeStruct('supraclav', [sc(2.4, -3.5, -.7), sc(7.8, -3.0, -.7), sc(14.6, 0.5, -.7)], .14, P.cadaverNerve, P.cadaverNerve);
    scd.isNerveLike = true;
    { const d = addSurface('platysma', { color: '#C27060', cad: '#9A6050', op: .9 });
      d.mat = makeMat(this.colorFor(d), .9, true); (d.mat as any).map = this.texSheet; d.mat.roughness = .6; d.eBase = .04;
      const nu = 12, nv = 18, pos: number[] = [], uv: number[] = [], idx: number[] = []; let last = [0, 0, 0];
      for (let a = 0; a <= nu; a++) for (let b = 0; b <= nv; b++) { const u = a / nu, v = b / nv, s = -3 + 20 * v, lmax = s < 4 ? 12.5 : Math.max(5.5, 12.5 - (s - 4) * 0.55), l = 1.2 + (lmax - 1.2) * u;
        const q = frontPt(G, l, s, -.55) || last; last = q; pos.push(-q[0], q[1], q[2]); uv.push(u, v); }
      for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) { const p = a * (nv + 1) + b, q = p + nv + 1; idx.push(p, q, p + 1, q, q + 1, p + 1); }
      const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      this.addMesh(d, g); d.anchor = fp(6.5, 10, -.5) || V(6.5, 10, 3);
    }
    { const d = addSurface('incisions', { color: '#6E1B16', cad: '#6E1B16', op: 1 });
      d.mat.color.set(this.colorFor(d)); d.mat.roughness = .4; d.eBase = .1;
      const lines: (Vector3 | null)[][] = [];
      const mid: (Vector3 | null)[] = []; for (let s = 7.3; s >= -14; s -= .5) mid.push(fp(0, s, .04)); lines.push(mid);
      const cl: (Vector3 | null)[] = [], cp = [[0.4, 2.6], [5, 3.1], [8.5, 4.0], [12, 4.7], [14.6, 5.2], [16.8, 5.4]];
      for (let k = 0; k < cp.length - 1; k++) for (let f = 0; f < 1; f += .25) cl.push(fp(cp[k][0] + (cp[k + 1][0] - cp[k][0]) * f, cp[k][1] + (cp[k + 1][1] - cp[k][1]) * f, .04));
      lines.push(cl);
      const inf: (Vector3 | null)[] = []; for (let th = 0; th <= 115; th += 4) { const r = th * DEG; inf.push(toV(proj(G, [Math.sin(r) * 34, -14, -0.6 + Math.cos(r) * 34], [-Math.sin(r), 0, -Math.cos(r)], .04))); } lines.push(inf);
      const arm: (Vector3 | null)[] = []; for (let t = -2; t <= 16; t += .75) arm.push(ap(t, 90 * DEG, .04));
      for (let th = 86; th >= 10; th -= 6) arm.push(ap(16, th * DEG, .04)); lines.push(arm);
      d.lines = []; d.guides = [];
      const guideMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8 });
      lines.forEach(pts => { const q = pts.filter((x): x is Vector3 => !!x); if (q.length < 2) return; const c = curveOf(q);
        const seg = Math.max(20, Math.round(c.getLength() * 3));
        const m = this.addMesh(d, new TubeGeometry(c, seg, .09, 6, false)); m.userData.inc = true; m.visible = false; // the cut mask draws the incisions
        (m.geometry as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.(); // drawn progressively, so no BVH
        const gm = new Mesh(new TubeGeometry(c, seg, .055, 5, false), guideMat); gm.visible = false; gm.renderOrder = 3; this.scene.add(gm); d.guides!.push(gm);
        d.lines!.push(c.getSpacedPoints(70));
        if (!d.curve) d.curve = c; });
      d.anchor = d.curve!.getPoint(.4);
    }
    const LM: Record<string, Vector3 | null> = { lmNotch: fp(0.3, 7.3, .05), lmAngle: fp(0.3, -0.4, .05), lmAcromion: toV(proj(G, [17.4, 30, -1.6], [0, -1, 0], .05)),
      lmInfraclav: fp(13.4, 2.2, .05), lmGroove: ap(4, 76 * DEG, .05), lmAntFold: fp(14.4, -5.5, .05), lmPostFold: toV(proj(G, [13.6, -6.5, -30], [0, 0, 1], .05)) };
    for (const id of Object.keys(LM)) { const p = LM[id]; if (!p) continue;
      const d = addSurface(id, { color: '#3B2A22', cad: '#3B2A22', op: 1, lm: true, anchor: p });
      d.mat.color.set(this.colorFor(d)); d.eBase = 0; const m = this.addMesh(d, sphereGeo, p); m.scale.setScalar(.32); }
    this.built = true;
  }

  /** Insertion point of a reflected muscle, from its content definition. */
  insertionOf(id: string): Vector3 | null {
    const o = this.C.byId[id]; if (!o || o.layer === 'nerves') return null;
    if (o.sheet) { const c = new Vector3(); o.sheet.i.forEach(p => c.add(v3(p))); return c.multiplyScalar(1 / o.sheet.i.length); }
    if (o.custom === 'deltoid') return deltoidGeo().ins;
    return null;
  }

  /** Builds the fold rig for a real mesh so forceps and the dissection steps can reflect it. */
  rigFold(d: RT) {
    if (!d.fold || !d.real || !d.meshes.length) return;
    const pivot = this.insertionOf(d.id); if (!pivot) return;
    const pos = d.meshes[0].geometry.attributes.position; const base = Float32Array.from(pos.array as Float32Array);
    const c = new Vector3(); for (let i = 0; i < pos.count; i++) c.add(tmpA.set(pos.getX(i), pos.getY(i), pos.getZ(i))); c.multiplyScalar(1 / pos.count);
    const dir = c.clone().sub(pivot).normalize();
    const outward = c.clone().sub(new Vector3(CENTER.x, c.y, CENTER.z - 1)).normalize();
    const axis = new Vector3().crossVectors(dir, outward).normalize();
    let span = 0; for (let i = 0; i < pos.count; i++) span = Math.max(span, tmpA.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(pivot).dot(dir));
    // Choose the rotation sense that moves the far end outward (away from the body).
    const probe = tmpA.copy(dir).multiplyScalar(span).applyAxisAngle(axis, 0.3).sub(dir.clone().multiplyScalar(span));
    if (probe.dot(outward) < 0) axis.negate();
    d.rig = { base, pivot, axis, dir, span: Math.max(1, span * 0.6) };
    d.foldSign = 1;
  }

  /** Cut masks for free dissection, one per shell, sharing the body's depth maps. */
  masks: Record<string, CutMask> = {};
  maskSpace: MaskSpace | null = null;
  /** Builds the mask space from the skin shell (needs the renderer for the depth maps). */
  buildMasks(renderer: WebGLRenderer) {
    const skin = this.R.S.skin?.meshes[0]; if (!skin) return;
    const space = new MaskSpace(skin.geometry); space.buildDepth(renderer, skin); this.maskSpace = space;
    for (const sh of this.C.shells) {
      const d = this.R.S[sh.id]; if (!d || !d.peel) continue;
      const mk = new CutMask(space); this.masks[sh.id] = mk;
      d.peel.uMask.value = mk.tex; d.peel.uMaskOn.value = 1; d.peel.uMaskMin.value.copy(space.min); d.peel.uMaskSize.value.copy(space.size);
    }
  }
  /** Picking helper: true when the shell surface at this point has been cut away. */
  isCut(sid: string, point: Vector3, normal: Vector3): boolean { const mk = this.masks[sid]; return mk ? mk.isRemoved(point, normal) : false; }
  flushMasks() { for (const k of Object.keys(this.masks)) this.masks[k].flush(); }
  resetMasks() { for (const k of Object.keys(this.masks)) this.masks[k].clear(); }

  /** Pool of structures a spotter session can pin: real anatomy, not helpers. */
  spotterPool(layers: Record<Layer, boolean>): Structure[] {
    return this.C.structures.filter(s => s.layer === 'nerves' || layers[s.layer]);
  }

  static lerpColor(a: string, b: string, t: number) { return '#' + new Color(a).lerp(new Color(b), t).getHexString(); }
}
