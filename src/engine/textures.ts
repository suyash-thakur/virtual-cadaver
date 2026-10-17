import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { ShellTex } from './materials';

/** Deterministic PRNG for repeatable textures. */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function canvas(size: number) { const c = document.createElement('canvas'); c.width = c.height = size; return [c, c.getContext('2d')!] as const; }
function tex(c: HTMLCanvasElement, srgb: boolean): Texture { const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; if (srgb) t.colorSpace = SRGBColorSpace; t.anisotropy = 4; return t; }

/** Skin: fine pores and faint mottling as a bump map, warm mottle as colour. */
function skinTex(): ShellTex {
  const r = rng(11); const [cb, gb] = canvas(512); const [cc, gc] = canvas(512);
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) { const x = r() * 512, y = r() * 512, s = 0.6 + r() * 1.6; gb.fillStyle = `rgba(0,0,0,${(0.08 + r() * 0.18).toFixed(2)})`; gb.beginPath(); gb.arc(x, y, s, 0, 6.283); gb.fill(); }
  for (let i = 0; i < 400; i++) { const x = r() * 512, y = r() * 512, s = 6 + r() * 22; gb.fillStyle = `rgba(255,255,255,${(0.03 + r() * 0.05).toFixed(2)})`; gb.beginPath(); gb.arc(x, y, s, 0, 6.283); gb.fill(); }
  gc.fillStyle = '#ffffff'; gc.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) { const x = r() * 512, y = r() * 512, s = 4 + r() * 30; gc.fillStyle = `rgba(${200 + (r() * 55) | 0},${120 + (r() * 60) | 0},${110 + (r() * 50) | 0},${(0.04 + r() * 0.08).toFixed(2)})`; gc.beginPath(); gc.arc(x, y, s, 0, 6.283); gc.fill(); }
  return { map: tex(cc, true), bumpMap: tex(cb, false), bumpScale: 0.06, roughness: 0.62 };
}

/** Superficial fascia: lobulated fat, a cobbled bump with brighter lobule centres. */
function fatTex(): ShellTex {
  const r = rng(23); const [cb, gb] = canvas(512); const [cc, gc] = canvas(512);
  gb.fillStyle = '#707070'; gb.fillRect(0, 0, 512, 512); gc.fillStyle = '#f2e3b0'; gc.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2200; i++) {
    const x = r() * 512, y = r() * 512, s = 5 + r() * 11;
    const gr = gb.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)'); gb.fillStyle = gr; gb.beginPath(); gb.arc(x, y, s, 0, 6.283); gb.fill();
    gc.fillStyle = `rgba(${225 + (r() * 30) | 0},${180 + (r() * 40) | 0},${90 + (r() * 60) | 0},0.6)`; gc.beginPath(); gc.arc(x, y, s * 0.85, 0, 6.283); gc.fill();
  }
  gc.strokeStyle = 'rgba(190,60,60,0.35)'; gc.lineWidth = 1.2;
  for (let i = 0; i < 60; i++) { gc.beginPath(); let x = r() * 512, y = r() * 512; gc.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - .5) * 60; y += (r() - .5) * 60; gc.lineTo(x, y); } gc.stroke(); }
  return { map: tex(cc, true), bumpMap: tex(cb, false), bumpScale: 0.12, roughness: 0.5 };
}

/** Deep fascia: glistening, with crossing collagen fibres. */
function fasciaTex(): ShellTex {
  const r = rng(37); const [cb, gb] = canvas(512);
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 700; i++) { const a = (r() < .5 ? 0.3 : -0.3) + (r() - .5) * 0.4, x = r() * 512, y = r() * 512, L = 40 + r() * 120; gb.strokeStyle = `rgba(${r() < .5 ? 255 : 0},${r() < .5 ? 255 : 0},${r() < .5 ? 255 : 0},${(0.05 + r() * 0.12).toFixed(2)})`; gb.lineWidth = 0.6 + r() * 1.4; gb.beginPath(); gb.moveTo(x, y); gb.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); gb.stroke(); }
  return { bumpMap: tex(cb, false), bumpScale: 0.05, roughness: 0.22 };
}

let cache: Record<string, ShellTex> | null = null;
export function bodyTextures(): Record<string, ShellTex> {
  if (!cache) {
    cache = { skin: skinTex(), fat: fatTex(), deepFascia: fasciaTex() };
    for (const k of Object.keys(cache)) { const t = cache[k]; const rep = k === 'skin' ? 1.2 : (k === 'fat' ? 1.6 : 2.4); for (const m of [t.map, t.bumpMap]) if (m) m.repeat.set(rep, rep); }
  }
  return cache;
}
