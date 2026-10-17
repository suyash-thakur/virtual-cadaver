/**
 * The body surface: a signed-distance field (trunk, neck, shoulder, arm) blended with the
 * coverage of every deep structure, meshed with surface nets at three iso-levels for skin,
 * superficial fascia and deep fascia. Everything here is in authoring space [l, s, a].
 */
import type { CatmullRomCurve3, Vector3 } from 'three';
import { armL, armDir } from '../coords';
import { sstep } from '../noise';

export type Cov = { curve: CatmullRomCurve3; r: number } | { pt: Vector3; r: number } | { arr: Float32Array; r: number };
export interface Covered { noCover?: boolean; cov: Cov[]; layer: string }

function smin(a: number, b: number, k: number) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function sdCap(p: number[], a: number[], b: number[], r1: number, r2: number) {
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2], bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / ((bax * bax + bay * bay + baz * baz) || 1e-9)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h; return Math.sqrt(dx * dx + dy * dy + dz * dz) - (r1 + (r2 - r1) * h);
}
function sdRoundBox(p: number[], c: number[], b: number[], r: number) {
  const qx = Math.abs(p[0] - c[0]) - b[0], qy = Math.abs(p[1] - c[1]) - b[1], qz = Math.abs(p[2] - c[2]) - b[2];
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}
const ARM0 = armL(-1, 0, -1.2), ARM1 = armL(28, 0, -1.2), AF = armL(4.5, 0.8, 1.0), PF = armL(4.5, 1.8, -3.0);
export function bodySDF(p: number[]): number {
  let d = sdRoundBox(p, [0, -6, -0.6], [10.3, 10, 5.0], 3.2);
  d = smin(d, sdCap(p, [0, 5, -1.3], [0, 21, -1.6], 6.0, 6.0), 2.5);
  d = smin(d, sdCap(p, [16.6, 1.0, -1.6], [16.6, 1.0, -1.6], 5.3, 5.3), 2.5);
  d = smin(d, sdCap(p, [3, 11, -3.0], [15.5, 5.0, -2.4], 4.0, 4.0), 2.5);
  d = smin(d, sdCap(p, ARM0, ARM1, 5.5, 4.3), 2.5);
  d = smin(d, sdCap(p, [7, -5, 4.4], AF, 2.4, 2.4), 2.5);
  d = smin(d, sdCap(p, [8, -9, -6.4], PF, 2.6, 2.6), 2.5);
  return d;
}

export interface Field { h: number; l0: number; s0: number; a0: number; nx: number; ny: number; nz: number; F: Float32Array }

export function covMargin(layer: string) { return layer === 'nerves' || layer === 'vessels' ? .9 : (layer === 'bones' ? 1.25 : 1.35); }

/** A sphere of radius R (authoring space) that the body surface must cover. */
export interface Splat { l: number; s: number; a: number; R: number }

/** Expands the coverage of every structure into splat spheres; runs on the main thread, cheap. */
export function collectSplats(order: Covered[]): Splat[] {
  const out: Splat[] = [];
  for (const d of order) {
    if (d.noCover || !d.cov.length) continue; const m = covMargin(d.layer);
    for (const c of d.cov) {
      if ('curve' in c) { const n = Math.max(2, Math.ceil(c.curve.getLength() / 0.6)); c.curve.getSpacedPoints(n).forEach(q => out.push({ l: -q.x, s: q.y, a: q.z, R: c.r + m })); }
      else if ('pt' in c) out.push({ l: -c.pt.x, s: c.pt.y, a: c.pt.z, R: c.r + m });
      else for (let k = 0; k < c.arr.length; k += 3) out.push({ l: -c.arr[k], s: c.arr[k + 1], a: c.arr[k + 2], R: c.r + m });
    }
  }
  return out;
}

/** Grid spacing `h`: 0.55 reproduces the prototype; smaller is smoother but cubic in cost. */
export function buildField(splats: Splat[], h = 0.45): Field {
  const l0 = -1.5, s0 = -26, a0 = -11.5;
  const nx = Math.round((39 - l0) / h) + 1, ny = Math.round((19.5 - s0) / h) + 1, nz = Math.round((11 - a0) / h) + 1;
  const N = nx * ny * nz, F = new Float32Array(N), C = new Float32Array(N).fill(10);
  for (const { l, s, a, R } of splats) {
    const ext = R + 2.2;
    const i0 = Math.max(0, Math.floor((l - ext - l0) / h)), i1 = Math.min(nx - 1, Math.ceil((l + ext - l0) / h));
    const j0 = Math.max(0, Math.floor((s - ext - s0) / h)), j1 = Math.min(ny - 1, Math.ceil((s + ext - s0) / h));
    const k0 = Math.max(0, Math.floor((a - ext - a0) / h)), k1 = Math.min(nz - 1, Math.ceil((a + ext - a0) / h));
    for (let k = k0; k <= k1; k++) { const dz = a0 + k * h - a; for (let j = j0; j <= j1; j++) { const dy = s0 + j * h - s; const row = nx * (j + ny * k);
      for (let i = i0; i <= i1; i++) { const dx = l0 + i * h - l; const v = Math.sqrt(dx * dx + dy * dy + dz * dz) - R; if (v < C[i + row]) C[i + row] = v; } } }
  }
  const p = [0, 0, 0];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    p[0] = l0 + i * h; p[1] = s0 + j * h; p[2] = a0 + k * h;
    const idx = i + nx * (j + ny * k); F[idx] = smin(bodySDF(p), C[idx], 1.6);
  }
  return { h, l0, s0, a0, nx, ny, nz, F };
}

export function sampleF(G: Field, l: number, s: number, a: number): number {
  const { nx, ny, nz, h, l0, s0, a0, F } = G;
  const x = (l - l0) / h, y = (s - s0) / h, z = (a - a0) / h;
  if (x < 0 || y < 0 || z < 0 || x >= nx - 1 || y >= ny - 1 || z >= nz - 1) return 5;
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const I = (ii: number, jj: number, kk: number) => F[ii + nx * (jj + ny * kk)];
  const c00 = I(i, j, k) * (1 - fx) + I(i + 1, j, k) * fx, c10 = I(i, j + 1, k) * (1 - fx) + I(i + 1, j + 1, k) * fx;
  const c01 = I(i, j, k + 1) * (1 - fx) + I(i + 1, j, k + 1) * fx, c11 = I(i, j + 1, k + 1) * (1 - fx) + I(i + 1, j + 1, k + 1) * fx;
  return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
}

/** Surface nets at `iso`; positions in authoring space, triangles wound for the mirrored world. */
export function surfaceNets(G: Field, iso: number): { pos: number[]; idx: number[] } {
  const { nx, ny, nz, h, l0, s0, a0, F } = G, cx = nx - 1, cy = ny - 1;
  const cell = new Int32Array(cx * cy * (nz - 1)).fill(-1), pos: number[] = [], v = new Float32Array(8);
  const ci = (i: number, j: number, k: number) => i + cx * (j + cy * k);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const x = i + (c & 1), y = j + ((c >> 1) & 1), z = k + ((c >> 2) & 1); v[c] = F[x + nx * (y + ny * z)] - iso; if (v[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let c = 0; c < 8; c++) for (let b = 1; b <= 4; b <<= 1) { if (c & b) continue; const c2 = c | b;
      if ((v[c] < 0) !== (v[c2] < 0)) { const t = v[c] / (v[c] - v[c2]);
        sx += (c & 1) + (b === 1 ? t : 0); sy += ((c >> 1) & 1) + (b === 2 ? t : 0); sz += ((c >> 2) & 1) + (b === 4 ? t : 0); n++; } }
    cell[ci(i, j, k)] = pos.length / 3;
    pos.push(l0 + (i + sx / n) * h, s0 + (j + sy / n) * h, a0 + (k + sz / n) * h);
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const g0 = F[i + nx * (j + ny * k)] - iso < 0;
    if ((F[(i + 1) + nx * (j + ny * k)] - iso < 0) !== g0) quad(cell[ci(i, j - 1, k - 1)], cell[ci(i, j, k - 1)], cell[ci(i, j, k)], cell[ci(i, j - 1, k)]);
    if ((F[i + nx * ((j + 1) + ny * k)] - iso < 0) !== g0) quad(cell[ci(i - 1, j, k - 1)], cell[ci(i, j, k - 1)], cell[ci(i, j, k)], cell[ci(i - 1, j, k)]);
    if ((F[i + nx * (j + ny * (k + 1))] - iso < 0) !== g0) quad(cell[ci(i - 1, j - 1, k)], cell[ci(i, j - 1, k)], cell[ci(i, j, k)], cell[ci(i - 1, j, k)]);
  }
  const e = h * .5;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
    const nxv = uy * wz - uz * wy, nyv = uz * wx - ux * wz, nzv = ux * wy - uy * wx;
    const ml = (pos[a] + pos[b] + pos[c]) / 3, ms = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, ma = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    const gx = sampleF(G, ml + e, ms, ma) - sampleF(G, ml - e, ms, ma), gy = sampleF(G, ml, ms + e, ma) - sampleF(G, ml, ms - e, ma), gz = sampleF(G, ml, ms, ma + e) - sampleF(G, ml, ms, ma - e);
    if (nxv * gx + nyv * gy + nzv * gz < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
  for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  return { pos, idx };
}

/** Laplacian smoothing on the surface-net mesh; removes the stair-step look of the cut edges. */
export function smoothMesh(pos: number[], idx: number[], iterations = 2, lambda = 0.5): void {
  const n = pos.length / 3; const nb: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b); }
  const out = new Float32Array(pos.length);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < n; v++) {
      const N = nb[v]; if (!N.length) { out[v * 3] = pos[v * 3]; out[v * 3 + 1] = pos[v * 3 + 1]; out[v * 3 + 2] = pos[v * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0; for (const u of N) { x += pos[u * 3]; y += pos[u * 3 + 1]; z += pos[u * 3 + 2]; }
      x /= N.length; y /= N.length; z /= N.length;
      out[v * 3] = pos[v * 3] + (x - pos[v * 3]) * lambda; out[v * 3 + 1] = pos[v * 3 + 1] + (y - pos[v * 3 + 1]) * lambda; out[v * 3 + 2] = pos[v * 3 + 2] + (z - pos[v * 3 + 2]) * lambda;
    }
    for (let i = 0; i < pos.length; i++) pos[i] = out[i];
  }
}

/** Order in which the skin comes away: 0 at the front midline, rising laterally and backward. */
export function peelAt(l: number, s: number, a: number): [number, number] {
  const phi = Math.atan2(Math.max(l, 0), a + 0.6) / Math.PI;
  const dl = l - 16, ds = s - 0.3, t = dl * 0.643 - ds * 0.766, nC = -dl * 0.766 - ds * 0.643, zC = a + 1.2, rr = Math.hypot(nC, zC);
  const w = sstep(-1.5, 3.5, t) * (rr < 9.5 ? 1 : 0);
  const psi = Math.acos(Math.max(-1, Math.min(1, zC / (rr || 1)))) / Math.PI;
  const armPeel = 0.06 + 0.88 * psi + sstep(15.5, 17.5, t) * 5;
  return [phi * (1 - w) + armPeel * w, w];
}

/** Marches from `st` along `dir` until the field drops below `iso`; returns the surface point or null. */
export function proj(G: Field, st: number[], dir: number[], iso: number): number[] | null {
  let prev: number[] | null = null;
  for (let t = 0; t < 60; t += .2) {
    const p = [st[0] + dir[0] * t, st[1] + dir[1] * t, st[2] + dir[2] * t];
    if (sampleF(G, p[0], p[1], p[2]) < iso) {
      if (!prev) return p; let lo = prev, hi = p;
      for (let k = 0; k < 10; k++) { const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]; if (sampleF(G, m[0], m[1], m[2]) < iso) hi = m; else lo = m; }
      return hi;
    }
    prev = p;
  }
  return null;
}
export const frontPt = (G: Field, l: number, s: number, iso: number) => proj(G, [l, s, 14], [0, 0, -1], iso);
export function armPt(G: Field, t: number, th: number, iso: number) {
  const ax = armL(t, 0, -1.2), d = armDir(th);
  return proj(G, [ax[0] + d[0] * 13, ax[1] + d[1] * 13, ax[2] + d[2] * 13], [-d[0], -d[1], -d[2]], iso);
}
