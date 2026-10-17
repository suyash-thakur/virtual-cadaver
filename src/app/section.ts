/**
 * Visible Human cryosection panel: picks the photographic slice that corresponds to the
 * app's section plane. The registration is approximate (a different body, arms by the
 * sides), so the panel is labelled as a reference, not an exact cut through the model.
 */
export interface VhManifest {
  credit: string; mmPerPx: number;
  volume: { w: number; h: number; first: number; step: number; count: number };
  axial: { first: number; step: number; count: number; width: number };
  sagittal: { xs: number[] }; coronal: { ys: number[] };
  register: { headSlice: number; headY: number; mmPerUnit: number; midlinePx: number; centrePy: number };
}

export type Axis = 'x' | 'y' | 'z';

let manifest: VhManifest | null | undefined;

export async function loadVh(base = import.meta.env.BASE_URL): Promise<VhManifest | null> {
  if (manifest !== undefined) return manifest;
  try { const r = await fetch(`${base}vh/manifest.json`, { cache: 'no-cache' }); manifest = r.ok ? await r.json() : null; }
  catch { manifest = null; }
  return manifest ?? null;
}

const nearest = (arr: number[], v: number) => arr.reduce((b, x) => Math.abs(x - v) < Math.abs(b - v) ? x : b, arr[0]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** World coordinate on `axis` → the slice image for it, plus a caption describing the level. */
export function sliceFor(m: VhManifest, axis: Axis, at: number, base = import.meta.env.BASE_URL): { src: string; caption: string; level: string } {
  const r = m.register;
  if (axis === 'y') {
    const raw = r.headSlice + (r.headY - at) * r.mmPerUnit;
    const n = clamp(Math.round((raw - m.axial.first) / m.axial.step) * m.axial.step + m.axial.first, m.axial.first, m.axial.first + (m.axial.count - 1) * m.axial.step);
    const mm = Math.round((n - r.headSlice));
    return { src: `${base}vh/axial/${n}.jpg`, level: `slice ${n}`, caption: `Axial section ${mm === 0 ? 'at the level of the humeral head' : (mm < 0 ? `${-mm} mm above` : `${mm} mm below`) + ' the humeral head'}. Anterior is at the top; the patient's right is on the left.` };
  }
  if (axis === 'x') {
    const px = clamp(Math.round(r.midlinePx + at * r.mmPerUnit), 0, m.volume.w - 1);
    const x = nearest(m.sagittal.xs, px); const mm = Math.round(x - r.midlinePx);
    return { src: `${base}vh/sagittal/${x}.jpg`, level: `x ${x}`, caption: `Sagittal section ${mm === 0 ? 'in the midline' : `${Math.abs(mm)} mm to the ${mm < 0 ? 'right' : 'left'} of the midline`}. Anterior is on the left; superior at the top.` };
  }
  const py = clamp(Math.round(r.centrePy - at * r.mmPerUnit), 0, m.volume.h - 1);
  const y = nearest(m.coronal.ys, py); const mm = Math.round(r.centrePy - y);
  return { src: `${base}vh/coronal/${y}.jpg`, level: `y ${y}`, caption: `Coronal section ${mm === 0 ? 'through the centre of the chest' : `${Math.abs(mm)} mm ${mm > 0 ? 'anterior' : 'posterior'} to the centre of the chest`}. The patient's right is on the left; superior at the top.` };
}
