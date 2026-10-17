import { Matrix4, Vector3, type Mesh, type PerspectiveCamera } from 'three';
import { CENTER } from './coords';
import type { Picker } from './picking';
import type { Registry, RT } from './registry';
import type { Viewport } from './camera';

interface Item { d: RT; x: number; y: number; side: number; lx: number; ly: number; w: number; pri: number }

/**
 * Screen-space label layout: leader lines pushed outward from the specimen centre,
 * stacking to avoid overlaps on each side, a cap on the number shown (highest priority
 * first) and an occlusion test so labels do not point at hidden structures.
 */
export class Labels {
  dirty = true;
  maxLabels = 14;
  private tmp = new Vector3();
  private lastCam = new Matrix4();
  constructor(private R: Registry, private camera: PerspectiveCamera, private leaders: SVGSVGElement, private picker: Picker) {}

  update(ids: Set<string>, priority: (d: RT) => number, selected: string | null, view: Viewport, occluders: Mesh[], force = false) {
    if (!force && !this.dirty && this.lastCam.equals(this.camera.matrixWorld)) return;
    this.lastCam.copy(this.camera.matrixWorld); this.dirty = false;
    const W = view.W, H = view.H, Wv = W - view.pr, tmp = this.tmp;
    tmp.copy(CENTER).project(this.camera);
    const cx = (tmp.x + 1) / 2 * W, cy = (1 - tmp.y) / 2 * H;
    let items: Item[] = [];
    for (const d of this.R.order) {
      const shown = ids.has(d.id) && (d.target > .2 || d.id === selected) && d.cur > .2 && d.anchor;
      if (!shown) { d.lbl.hidden = true; continue; }
      tmp.copy(d.anchor).project(this.camera);
      const x = (tmp.x + 1) / 2 * W, y = (1 - tmp.y) / 2 * H;
      if (tmp.z > 1 || tmp.z < -1 || x < 0 || x > Wv || y < view.tb - 8 || y > H - view.sb) { d.lbl.hidden = true; continue; }
      items.push({ d, x, y, side: 1, lx: 0, ly: 0, w: 0, pri: d.id === selected ? 100 : priority(d) });
    }
    items.sort((a, b) => b.pri - a.pri);
    // Occlusion: only test the candidates that might be shown, selected is always kept.
    const kept: Item[] = [];
    for (const it of items) {
      if (kept.length >= this.maxLabels) { it.d.lbl.hidden = true; continue; }
      if (it.d.id !== selected && it.pri < 50 && this.picker.occluded(it.d.anchor, it.d, occluders)) { it.d.lbl.hidden = true; continue; }
      kept.push(it);
    }
    items = kept;
    items.forEach(it => { if (it.d.lbl.hidden) it.d.lbl.hidden = false; });
    items.forEach(it => { if (!it.d.lw) it.d.lw = it.d.lbl.offsetWidth || 80; });
    items.forEach(it => {
      let ux = it.x - cx, uy = it.y - cy; const len = Math.hypot(ux, uy);
      if (len < 1) { ux = 0; uy = -1; } else { ux /= len; uy /= len; }
      const L = it.d.id === selected ? 34 : 24;
      it.side = ux < 0 ? -1 : 1; it.lx = it.x + ux * L; it.ly = it.y + uy * L; it.w = it.d.lw!;
      if (it.side > 0) it.lx = Math.min(it.lx, Wv - it.w - 4); else it.lx = Math.max(it.lx, it.w + 4);
    });
    for (const side of [-1, 1]) {
      const g = items.filter(i => i.side === side).sort((a, b) => a.ly - b.ly), placed: Item[] = [];
      for (const it of g) {
        let moved = true, guard = 0;
        while (moved && guard++ < 40) { moved = false;
          for (const p of placed) {
            const a0 = side > 0 ? it.lx : it.lx - it.w, a1 = side > 0 ? it.lx + it.w : it.lx;
            const b0 = side > 0 ? p.lx : p.lx - p.w, b1 = side > 0 ? p.lx + p.w : p.lx;
            if (a0 < b1 && b0 < a1 && Math.abs(it.ly - p.ly) < 23) { it.ly = p.ly + 23; moved = true; }
          }
        }
        placed.push(it);
      }
    }
    let svg = '';
    for (const it of items) {
      const el = it.d.lbl;
      el.style.transform = `translate(${it.lx.toFixed(1)}px,${it.ly.toFixed(1)}px) translate(${it.side < 0 ? '-100%' : '0'},-50%)`;
      el.style.zIndex = it.d.id === selected ? '3' : '1';
      el.classList.toggle('sel', it.d.id === selected);
      svg += `<line x1="${it.x.toFixed(1)}" y1="${it.y.toFixed(1)}" x2="${it.lx.toFixed(1)}" y2="${it.ly.toFixed(1)}"/><circle cx="${it.x.toFixed(1)}" cy="${it.y.toFixed(1)}" r="2.6"/>`;
    }
    this.leaders.innerHTML = svg;
  }
}
