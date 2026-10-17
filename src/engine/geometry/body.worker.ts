/// <reference lib="webworker" />
import { buildField, surfaceNets, smoothMesh, peelAt, type Splat } from './body';
import { noise3 } from '../noise';

export interface BodyRequest { splats: Splat[]; h: number; shells: { id: string; iso: number; tone: [number, number, number] }[] }
export interface ShellMesh { id: string; pos: Float32Array; peel: Float32Array; warm: Float32Array; col: Float32Array; idx: Uint32Array }
export interface BodyResponse { field: { h: number; l0: number; s0: number; a0: number; nx: number; ny: number; nz: number; F: Float32Array }; shells: ShellMesh[] }

self.onmessage = (e: MessageEvent<BodyRequest>) => {
  const { splats, h, shells } = e.data;
  const G = buildField(splats, h);
  const out: ShellMesh[] = [];
  for (const sh of shells) {
    const { pos, idx } = surfaceNets(G, sh.iso);
    smoothMesh(pos, idx, 2, 0.45);
    const nV = pos.length / 3;
    const wp = new Float32Array(pos.length), peel = new Float32Array(nV), warm = new Float32Array(nV), col = new Float32Array(pos.length);
    for (let v = 0; v < nV; v++) {
      const l = pos[v * 3], s = pos[v * 3 + 1], a = pos[v * 3 + 2];
      wp[v * 3] = -l; wp[v * 3 + 1] = s; wp[v * 3 + 2] = a;
      const pw = peelAt(l, s, a); peel[v] = pw[0]; warm[v] = pw[1];
      const n = sh.tone[0] + sh.tone[1] * noise3(l * sh.tone[2], s * sh.tone[2], a * sh.tone[2]);
      col[v * 3] = n; col[v * 3 + 1] = n; col[v * 3 + 2] = n;
    }
    out.push({ id: sh.id, pos: wp, peel, warm, col, idx: Uint32Array.from(idx) });
  }
  const res: BodyResponse = { field: G, shells: out };
  const transfer = [G.F.buffer] as ArrayBuffer[];
  out.forEach(m => transfer.push(m.pos.buffer as ArrayBuffer, m.peel.buffer as ArrayBuffer, m.warm.buffer as ArrayBuffer, m.col.buffer as ArrayBuffer, m.idx.buffer as ArrayBuffer));
  (self as unknown as Worker).postMessage(res, transfer);
};
