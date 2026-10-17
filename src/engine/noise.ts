export function hash3(i: number, j: number, k: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  let fx = x - i, fy = y - j, fz = z - k;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  return L(L(L(hash3(i, j, k), hash3(i + 1, j, k), fx), L(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), fx), fy),
           L(L(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), fx), L(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), fx), fy), fz);
}
export const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
