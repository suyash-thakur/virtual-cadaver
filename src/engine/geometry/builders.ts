import { BufferGeometry, CanvasTexture, CatmullRomCurve3, Float32BufferAttribute, RepeatWrapping, SRGBColorSpace, SphereGeometry, Vector3 } from 'three';
import { V, armL, armDir, DEG } from '../coords';
import { noise3 } from '../noise';

export const curveOf = (pts: Vector3[]) => new CatmullRomCurve3(pts, false, 'centripetal');
export const sphereGeo = new SphereGeometry(1, 14, 10);

/** Procedural fibre texture: faint parallel strokes, used as colour and bump map for muscle and nerve. */
export function fibreTex(vertical: boolean, seed = 1): CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 46; k++) {
    const q = rnd() * 128; g.strokeStyle = `rgba(60,10,0,${(0.06 + rnd() * 0.12).toFixed(2)})`;
    g.lineWidth = 0.8 + rnd() * 1.6; g.beginPath();
    if (vertical) { g.moveTo(q, 0); g.lineTo(q + (rnd() - .5) * 6, 128); } else { g.moveTo(0, q); g.lineTo(128, q + (rnd() - .5) * 6); }
    g.stroke();
  }
  const t = new CanvasTexture(cv); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; return t;
}

/** Displaces vertices along their normals by low-frequency noise. */
export function roughen(g: BufferGeometry, amp: number, freq: number): BufferGeometry {
  if (!amp) return g;
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = (noise3(x * freq + 11, y * freq, z * freq) - .5) * 2 * amp;
    p.setXYZ(i, x + n.getX(i) * k, y + n.getY(i) * k, z + n.getZ(i) * k);
  }
  g.computeVertexNormals(); return g;
}

export interface SheetGeo { g: BufferGeometry; ins: Vector3[]; nu: number; nv: number; base: Float32Array; oc: Vector3; ic: Vector3 }
/** A bulging sheet between an origin curve and an insertion curve (flat muscles and fasciae). */
export function sheetGeo(o: Vector3[], i: Vector3[], bulge: number, bdir?: [number, number, number], nu = 18, nv = 12): SheetGeo {
  const bw = bdir ? V(bdir[0], bdir[1], bdir[2]).normalize() : new Vector3(0, 0, 1);
  const co = curveOf(o), ci = curveOf(i), pos: number[] = [], idx: number[] = [], uv: number[] = [], ins: Vector3[] = [];
  for (let a = 0; a <= nu; a++) {
    const u = a / nu, po = co.getPoint(u), pi = ci.getPoint(u); ins.push(pi);
    for (let b = 0; b <= nv; b++) {
      const v = b / nv, p = po.clone().lerp(pi, v);
      p.addScaledVector(bw, bulge * Math.sin(Math.PI * v) * (0.65 + 0.35 * Math.sin(Math.PI * u)));
      pos.push(p.x, p.y, p.z); uv.push(u, v);
    }
  }
  for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) { const p = a * (nv + 1) + b, q = p + nv + 1; idx.push(p, q, p + 1, q, q + 1, p + 1); }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const oc = new Vector3(), ic = new Vector3();
  o.forEach(p => oc.add(p)); oc.multiplyScalar(1 / o.length); i.forEach(p => ic.add(p)); ic.multiplyScalar(1 / i.length);
  return { g, ins, nu, nv, base: Float32Array.from(pos), oc, ic };
}

/** A fan of triangles from a centre to a ring (scapula, subscapularis, infraspinatus). Inputs are authoring space. */
export function plateGeo(c: [number, number, number], ring: [number, number, number][], shrink: number, dz: number): { g: BufferGeometry; pts: Vector3[] } {
  const C = V(c[0], c[1], c[2] + dz), pts = ring.map(p => V(p[0], p[1], p[2] + dz).lerp(C, shrink));
  const pos = [C.x, C.y, C.z]; pts.forEach(p => pos.push(p.x, p.y, p.z)); const idx: number[] = [];
  for (let k = 0; k < pts.length; k++) idx.push(0, 1 + k, 1 + ((k + 1) % pts.length));
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals(); return { g, pts: [C].concat(pts) };
}

export interface DeltoidGeo { g: BufferGeometry; base: Float32Array; rad: Vector3[]; ins: Vector3 }
export function deltoidGeo(): DeltoidGeo {
  const nu = 22, nv = 18, pos: number[] = [], uv: number[] = [], idx: number[] = [], rad: Vector3[] = [];
  for (let b = 0; b <= nv; b++) {
    const v = b / nv, t = -2.6 + 15.6 * v, r = 4.7 - 3.2 * Math.pow(v, 1.3);
    const thf = (72 - 47 * Math.pow(v, 1.2)) * DEG, thb = (-105 + 80 * Math.pow(v, 1.2)) * DEG, ax = armL(t, 0, -1.2);
    for (let a = 0; a <= nu; a++) {
      const u = a / nu, th = thb + (thf - thb) * u, d = armDir(th);
      const p = V(ax[0] + d[0] * r, ax[1] + d[1] * r, ax[2] + d[2] * r); pos.push(p.x, p.y, p.z); uv.push(u, v); rad.push(V(d[0], d[1], d[2]));
    }
  }
  for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) { const p = b * (nu + 1) + a, q = p + nu + 1; idx.push(p, p + 1, q, q, p + 1, q + 1); }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const ia = armL(13, 0, -1.2), ins = V(ia[0] + 0.766 * 1.5, ia[1] + 0.643 * 1.5, ia[2]);
  return { g, base: Float32Array.from(pos), rad, ins };
}

export function fatPadGeo(): BufferGeometry {
  const g = new SphereGeometry(1, 48, 34), p = g.attributes.position, C = [13.6, -2.6, 0.3], D = [0.643, -0.766], U = [0.766, 0.643];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = 1 + .26 * (noise3(x * 2.3 + 5, y * 2.3, z * 2.3) - .5) + .12 * (noise3(x * 6, y * 6 + 3, z * 6) - .5);
    const l = C[0] + (D[0] * x * 4.6 + U[0] * y * 3.0) * r, sv = C[1] + (D[1] * x * 4.6 + U[1] * y * 3.0) * r, a = C[2] + z * 2.4 * r;
    p.setXYZ(i, -l, sv, a);
  }
  g.computeVertexNormals(); return g;
}
