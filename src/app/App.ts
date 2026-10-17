import { Mesh, MeshBasicMaterial, MeshStandardMaterial, Plane, RingGeometry, SphereGeometry, Spherical, Vector3 } from 'three';
import type { Content, Layer, Lesion, Step } from '../content';
import { CameraRig } from '../engine/camera';
import { Labels } from '../engine/labels';
import { Picker, curveParamNear, setCutTest } from '../engine/picking';
import type { RT } from '../engine/registry';
import type { Gfx } from '../engine/renderer';
import { Specimen, type PaletteMode } from '../engine/specimen';
import { loadAssets, applyPendingAssets, realSkin } from '../engine/assets';
import { loadVh, sliceFor, type VhManifest } from './section';
import { PROGRESS_KEY, emptyProgress, parseProgress, recordLesion, recordSpotter, recordStep, stats, type Progress } from '../logic/progress';
import { blendState, endState, initialState, isIncisionStep, stepState, type DissectState } from '../logic/dissect';
import { computeLesion, customLesion, type LesionResult } from '../logic/lesion';
import { computeTrace, type NerveGraph } from '../logic/trace';
import { buildSession, grade, summarise, updateBox, type Attempt, type LeitnerBox, type Question, type Summary } from '../logic/spotter';
import { chip, infoHTML, legendHTML, lesionHTML, photoHTML, spotterHTML, type HtmlCtx } from './html';

export type Mode = 'dissect' | 'explore' | 'trace' | 'lesion' | 'spotter';
export type Tool = 'turn' | 'scalpel' | 'lift';
type SectionAxis = 'x' | 'y' | 'z';
const SECTION_RANGE: Record<SectionAxis, [number, number]> = { x: [-40, 3], y: [-27, 20], z: [-13, 13] };
type Continuous = Pick<DissectState, 'skin' | 'fat' | 'fascia' | 'inc' | 'fold'>;

const BOX_KEY = 'vc.spotter.box.v1';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class App {
  spec: Specimen;
  rig: CameraRig;
  labels: Labels;
  picker: Picker;
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  mode: Mode = 'dissect';
  sel: string | null = null;
  traceSet: Set<string> | null = null;
  layers: Record<Layer, boolean> = { nerves: true, skin: false, supmus: false, deepmus: true, bones: true, vessels: true };
  labelMode: 'off' | 'key' | 'all' = 'key';
  colorBy: Record<Mode, PaletteMode> = { dissect: 'cadaver', explore: 'cord', trace: 'cord', lesion: 'cord', spotter: 'cord' };
  step = 0; done = true;
  hands = { on: false, q: 0, last: null as { x: number; y: number } | null };
  emph = new Set<string>();
  lesion: { active: Lesion | null; result: LesionResult | null } = { active: null, result: null };
  spotter: { session: Question[] | null; i: number; chosen: number | null; attempts: Attempt[]; summary: Summary | null; box: LeitnerBox; ghost: Set<string> } = { session: null, i: 0, chosen: null, attempts: [], summary: null, box: {}, ghost: new Set() };

  /* free dissection */
  tool: Tool = 'turn';
  removed = new Set<string>();
  private undoStack: { label: string; undo: () => void }[] = [];
  private stroke: { d: RT; last: Vector3; channel: 'cut' | 'line'; r: number } | null = null;
  private cursorRing: Mesh | null = null;
  private hoverId: string | null = null;
  private hoverMove: { x: number; y: number } | null = null;
  private pendingRemove: { d: RT; x: number; y: number } | null = null;
  private pointerMove: { x: number; y: number } | null = null;
  section: { axis: SectionAxis | null; t: number; flip: boolean } = { axis: null, t: 0.5, flip: false };
  progress: Progress = emptyProgress();
  private vh: VhManifest | null = null;

  private DP: Continuous = initialState(); private DT: Continuous = initialState();
  private dissectDirty = true;
  private G: NerveGraph = {};
  private markers: Mesh[] = [];
  private pin: HTMLDivElement;
  private knife = el<HTMLDivElement>('knife');
  private sheet = el<HTMLElement>('sheet'); private body = el<HTMLElement>('sheetBody');
  private modesEl = document.querySelector('.modes') as HTMLElement;
  private canvas: HTMLCanvasElement;
  private last = performance.now();
  /* adaptive resolution: drop the pixel ratio when frames run long, raise it back when they are quick */
  private maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  private pixelRatio = this.maxPixelRatio;
  private frameTimes: number[] = [];
  private adaptResolution(dtMs: number) {
    const ft = this.frameTimes; ft.push(dtMs); if (ft.length < 30) return;
    const sorted = ft.slice().sort((a, b) => a - b), median = sorted[sorted.length >> 1]; ft.length = 0;
    let next = this.pixelRatio;
    if (median > 28 && next > 0.75) next = Math.max(0.75, next - 0.25);
    else if (median < 12 && next < this.maxPixelRatio) next = Math.min(this.maxPixelRatio, next + 0.25);
    if (next !== this.pixelRatio) { this.pixelRatio = next; this.gfx.renderer.setPixelRatio(next); this.layout(); }
  }

  constructor(public C: Content, public gfx: Gfx, private app: HTMLElement) {
    this.canvas = gfx.renderer.domElement;
    C.nerves.forEach(n => { this.G[n.id] = n; });
    this.spec = new Specimen(C, gfx.scene, el('labels'), id => this.select(id, { centre: this.spec.S[id].anchor }));
    this.rig = new CameraRig(gfx.camera, this.canvas, C.views, this.reduceMotion);
    this.rig.onChange = () => { this.labels.dirty = true; };
    this.picker = new Picker(gfx.camera, this.canvas, this.spec.R);
    this.labels = new Labels(this.spec.R, gfx.camera, document.getElementById('leaders') as unknown as SVGSVGElement, this.picker);
    this.pin = document.createElement('div'); this.pin.className = 'pin'; this.pin.hidden = true; app.appendChild(this.pin);
    try { this.spotter.box = JSON.parse(localStorage.getItem(BOX_KEY) || '{}'); } catch { this.spotter.box = {}; }
    try { const raw = localStorage.getItem(PROGRESS_KEY); if (raw) this.progress = parseProgress(raw); } catch { this.progress = emptyProgress(); }
    this.bindUI();
  }

  get S() { return this.spec.S; }
  get order() { return this.spec.order; }
  get pal() { return this.colorBy[this.mode]; }
  private ctx(): HtmlCtx { return { C: this.C, S: this.S, dotColor: d => this.spec.dotColor(d), famColor: d => this.C.palette.families[d.fam!].c, mode: this.mode, traceSet: this.traceSet }; }

  async start() {
    this.spec.palette = this.pal;
    this.applyColors();
    new ResizeObserver(() => this.layout()).observe(this.app);
    new ResizeObserver(() => this.layout()).observe(this.sheet);
    this.updateTargets(); this.renderSheet(); this.layout();
    this.rig.snapTo('specimen');
    requestAnimationFrame(t => this.frame(t));
    try { const ids = await loadAssets(this.spec); if (ids.length) console.info(`real meshes: ${ids.join(', ')}`); } catch (e) { console.warn('assets', e); }
    this.applyColors();
    try { await this.spec.buildBody(realSkin || undefined); }
    catch (err) { console.error(err); el('loading').textContent = 'The skin layers could not be built on this device. The deeper layers still work.'; setTimeout(() => { el('loading').hidden = true; }, 4000); }
    if (this.spec.built) el('loading').hidden = true;
    this.spec.built = true;
    try { const ids = applyPendingAssets(this.spec); if (ids.length) console.info(`real surface meshes: ${ids.join(', ')}`); } catch (e) { console.warn('pending assets', e); }
    try { this.spec.buildMasks(this.gfx.renderer); setCutTest((sid, p, n) => this.spec.isCut(sid, p, n)); } catch (e) { console.warn('cut masks', e); }
    this.renderProgress();
    this.refreshLabelColors(); this.updateTargets(); this.renderSheet(); this.applyDissect();
    this.goStep(0, 'jump');
    loadVh().then(m => { this.vh = m; if (this.section.axis) this.renderSheet(); });
  }

  /* ---------- layout ---------- */
  isWide() { return this.app.clientWidth >= 860 && this.app.clientWidth > this.app.clientHeight * 1.05; }
  layout() {
    const W = this.app.clientWidth, H = this.app.clientHeight;
    this.gfx.renderer.setSize(W, H, false);
    document.body.classList.toggle('wide', this.isWide());
    const ar = this.app.getBoundingClientRect(), mr = this.modesEl.getBoundingClientRect(), sr = this.sheet.getBoundingClientRect();
    const tb = mr.bottom - ar.top + 4; let sb = 0, pr = 0;
    if (this.isWide()) pr = sr.width; else sb = Math.max(0, ar.bottom - sr.top + 4);
    this.rig.layout(W, H, tb, sb, pr);
  }

  /* ---------- dissection state ---------- */
  private stepVis(): DissectState | null { return this.mode === 'dissect' ? stepState(this.C.steps, this.step, this.done) : null; }
  private setDT(v: DissectState | Continuous | null) { const s = v || initialState(); this.DT = { skin: [...s.skin], fat: [...s.fat], fascia: [...s.fascia], inc: s.inc, fold: { ...s.fold } }; }
  private snapDP() { this.DP = { skin: [...this.DT.skin], fat: [...this.DT.fat], fascia: [...this.DT.fascia], inc: this.DT.inc, fold: { ...this.DT.fold } }; }
  private approach(cur: number, tgt: number, rate: number, dt: number) { if (this.reduceMotion) return tgt; const d = tgt - cur, m = rate * dt; return Math.abs(d) <= m ? tgt : cur + Math.sign(d) * m; }
  private stepDissect(dt: number) {
    let ch = false; const DP = this.DP, DT = this.DT;
    (['skin', 'fat', 'fascia'] as const).forEach(k => { for (let i = 0; i < 2; i++) { const n = this.approach(DP[k][i], DT[k][i], .34, dt); if (n !== DP[k][i]) { DP[k][i] = n; ch = true; } } });
    const ni = this.approach(DP.inc, DT.inc, .5, dt); if (ni !== DP.inc) { DP.inc = ni; ch = true; }
    Object.keys(DT.fold).forEach(k => { const n = this.approach(DP.fold[k] ?? 0, DT.fold[k], .55, dt); if (n !== DP.fold[k]) { DP.fold[k] = n; ch = true; } });
    if (ch || this.dissectDirty) { this.dissectDirty = false; this.applyDissect(); }
  }
  private applyDissect() { this.spec.applyDissect(this.DP.skin, this.DP.fat, this.DP.fascia, this.DP.inc, this.DP.fold); this.syncIncisionMask(); this.labels.dirty = true; }
  /** Guide points of the incision lines in order, with their line index. */
  private guidePoints(): { p: Vector3; line: number }[] {
    const inc = this.S.incisions; if (!inc || !inc.lines) return [];
    const out: { p: Vector3; line: number }[] = []; inc.lines.forEach((l, li) => l.forEach(p => out.push({ p, line: li }))); return out;
  }
  /**
   * The cut mask is the only renderer of incisions. The step's progress (DP.inc, 0..1 along the
   * guide lines) paints the guide lines into the mask and going backwards clears it. While the
   * student is drawing, or has stopped midway, their own strokes are the incisions.
   */
  private incPaintedSet = new Set<number>();
  private syncIncisionMask() {
    const mk = this.spec.masks.skin; if (!mk) return;
    const incStep = this.C.steps.findIndex(isIncisionStep);
    if (this.step === incStep && (this.hands.on || !this.done)) return;
    const pts = this.guidePoints(); if (!pts.length) return;
    const want = Math.round(Math.min(1, Math.max(0, this.DP.inc)) * pts.length);
    const cut = (i: number) => this.incPaintedSet.has(i) || !!(this.covered && this.covered.has(i));
    const have = this.incPaintedSet.size + (this.covered ? this.covered.size : 0);
    if (want < have) { mk.clear(); this.incPaintedSet.clear(); this.covered = null; }
    for (let i = 0; i < want; i++) {
      if (cut(i)) continue;
      const prev = i > 0 && pts[i - 1].line === pts[i].line ? pts[i - 1].p : null; // always a segment, so no isolated dots
      mk.stroke(prev ? [prev, pts[i].p] : [pts[i].p], App.INCISION_R, 'line', false);
      this.incPaintedSet.add(i);
    }
  }

  /* ---------- visibility ---------- */
  updateTargets() {
    const vis = this.stepVis(), S = this.S, st = this.C.steps[this.step];
    const nerveSel = !!(this.sel && S[this.sel] && S[this.sel].layer === 'nerves');
    const les = this.lesion.result;
    for (const d of this.order) {
      let on: boolean;
      if (d.layer === 'nerves') on = true; else if (vis) on = true; else on = !!this.layers[d.layer];
      if (d.id === 'incisions') on = vis ? (vis.inc > 0 && vis.skin[0] < 0.02) : false;
      if (d.lm) on = on && (!vis || vis.skin[0] < 0.02);
      if (vis && vis.hide.includes(d.id)) on = false;
      let t = on ? 1 : 0;
      if (vis && on && vis.dim.includes(d.id)) t = .3;
      if (vis && this.hands.on && this.hands.q > 0 && (st.hide || []).includes(d.id) && t > 0) t = Math.max(.02, 1 - this.hands.q);
      if (!vis && on && nerveSel && (d.layer === 'supmus' || d.layer === 'deepmus' || d.layer === 'skin')) t = Math.min(t, .35);
      if (this.mode === 'lesion') {
        if (d.layer === 'nerves') t = 1;
        else if (d.layer === 'skin' || d.kind === 'Fascia' || d.id === 'nodes') t = 0;
        else if (d.layer === 'supmus' || d.layer === 'deepmus') t = (les && les.m3d[d.id]) ? .95 : .35;
        else if (d.layer === 'vessels') t = .25;
        else if (d.layer === 'bones') t = 1;
      }
      if (this.mode === 'trace' && this.traceSet) {
        if (d.layer === 'nerves') t = this.traceSet.has(d.id) ? 1 : .08;
        else t = on && d.layer !== 'skin' ? .18 : 0;
      }
      if (this.mode === 'spotter') { if (d.surface) t = 0; else if (this.spotter.ghost.has(d.id)) t = Math.min(t, .12); }
      if (!vis && this.removed.has(d.id)) t = 0;
      d.target = t;
    }
    this.emph = new Set(vis ? vis.emph : []);
    this.labels.dirty = true;
  }

  /* ---------- colours ---------- */
  private lesionColor(d: RT): string | null {
    const r = this.lesion.result; if (this.mode !== 'lesion' || !r) return null;
    if (d.layer === 'nerves') { const s = r.status[d.id]; if (s === 'lost') return '#6E7277'; if (s === 'partial') return Specimen.lerpColor(this.spec.colorFor(d), '#6E7277', .55); return null; }
    const m = r.m3d[d.id]; if (m) return m === 'paralysed' ? '#8E9BB6' : '#C9A27E';
    return null;
  }
  applyColors() {
    this.spec.palette = this.pal;
    this.spec.applyColors(d => this.lesionColor(d));
    this.refreshLabelColors();
    document.querySelectorAll<HTMLButtonElement>('#segColor button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.color === this.pal)));
  }
  private refreshLabelColors() { for (const d of this.order) d.lbl.style.setProperty('--sw', this.spec.dotColor(d)); }

  /* ---------- labels ---------- */
  private labelIds(): Set<string> {
    let ids: Set<string>; const S = this.S, st = this.C.steps[this.step];
    if (this.labelMode === 'off') ids = new Set();
    else if (this.mode === 'dissect') ids = new Set(this.done && !this.hands.on ? st.find : (this.step === 0 ? this.C.steps[0].find : []));
    else if (this.mode === 'lesion') { ids = new Set();
      const r = this.lesion.result;
      if (r) { r.atIds.forEach(a => ids.add(a)); Object.keys(r.status).forEach(id => { if (S[id].key && r.status[id] === 'lost') ids.add(id); }); Object.keys(r.m3d).forEach(id => ids.add(id)); }
      else this.order.forEach(d => { if (d.key) ids.add(d.id); }); }
    else if (this.mode === 'trace' && this.traceSet) ids = new Set([...this.traceSet].filter(i => S[i].key || this.labelMode === 'all'));
    else if (this.mode === 'spotter') { ids = new Set(); const q = this.currentQuestion(); if (q && this.spotter.chosen != null) ids.add(q.targetId); }
    else ids = new Set(this.order.filter(d => this.labelMode === 'all' ? (d.layer === 'nerves' || d.landmark) : d.key).map(d => d.id));
    if (this.sel) ids.add(this.sel);
    return ids;
  }
  private labelPriority = (d: RT): number => {
    if (this.mode === 'dissect' && this.C.steps[this.step].find.includes(d.id)) return 60;
    if (this.emph.has(d.id)) return 55;
    if (d.key) return 30; if (d.landmark) return 20; return 10;
  };

  /* ---------- panel ---------- */
  renderSheet() {
    const ctx = this.ctx(), S = this.S; let h = '';
    if (this.mode === 'dissect') {
      const st = this.C.steps[this.step], last = this.step === this.C.steps.length - 1, built = this.spec.built;
      h = `<p class="kicker">Step ${this.step + 1} of ${this.C.steps.length}</p><div class="progress">${this.C.steps.map((_, i) => `<span class="${i <= this.step ? 'on' : ''}"></span>`).join('')}</div>
        <h2 class="sname">${st.title}</h2><p>${st.text}</p>`;
      if (this.done || !st.act) h += `<h3 class="sec">${st.act ? 'Now find' : 'Find these'}</h3><div class="chips">${st.find.map(id => chip(ctx, id)).join('')}</div>`;
      if (this.hands.on) {
        h += `<h3 class="sec">${isIncisionStep(st) ? 'Your scalpel' : 'Your hands'}</h3><p id="handsHint">${this.handsHint()}</p><div class="handsbar"><i id="handsBar" style="width:${(this.hands.q * 100).toFixed(1)}%"></i></div>
          <div class="actions"><button class="btn" data-act="stop">Stop and turn the specimen</button><button class="btn primary" data-act="do">Finish it for me</button></div>`;
        this.body.innerHTML = h; return;
      }
      h += `<div class="actions"><button class="btn" data-act="prev" ${this.step === 0 ? 'disabled' : ''}>Back</button>`;
      if (st.act && !this.done) h += `<button class="btn primary" data-act="hands" ${built ? '' : 'disabled'}>${isIncisionStep(st) ? 'Use the scalpel' : 'Do it by hand'}</button><button class="btn" data-act="do" ${built ? '' : 'disabled'}>Show me</button>`;
      else { h += `<button class="btn primary" data-act="next" ${built ? '' : 'disabled'}>${last ? 'Start again' : 'Next step'}</button>`; if (st.act) h += `<button class="btn" data-act="replay">Replay</button>`; }
      h += `</div><hr>` + photoHTML(ctx, st);
      if (this.sel && S[this.sel]) h += `<hr>` + infoHTML(ctx, S[this.sel], { compact: true }) + `<div class="actions"><button class="btn" data-act="focus">Zoom to it</button><button class="btn" data-act="close">Hide details</button></div>`;
    } else if (this.mode === 'lesion') {
      h = lesionHTML(ctx, this.lesion.active, this.lesion.result);
      if (this.sel && S[this.sel]) h += `<hr>` + infoHTML(ctx, S[this.sel], { compact: true }) + `<div class="actions"><button class="btn" data-act="close">Hide details</button></div>`;
    } else if (this.mode === 'spotter') {
      const sp = this.spotter, pool = this.spec.spotterPool(this.layers), now = Date.now();
      h = spotterHTML(ctx, { session: sp.session, i: sp.i, chosen: sp.chosen, summary: sp.summary, dueCount: pool.filter(s => sp.box[s.id] && sp.box[s.id].due <= now).length, poolSize: pool.length });
      if (this.sel && S[this.sel] && (!sp.session || sp.chosen != null || sp.summary)) h += `<hr>` + infoHTML(ctx, S[this.sel], { compact: true }) + `<div class="actions"><button class="btn" data-act="close">Hide details</button></div>`;
    } else if (this.sel && S[this.sel]) {
      h = infoHTML(ctx, S[this.sel]) + this.sectionHTML();
    } else if (this.mode === 'trace') {
      h = `<h2 class="sname">Trace the fibres</h2><p class="muted">Pick a root to light up every nerve its fibres reach, or tap any branch to follow it back to its roots.</p>
        <div class="chips">${this.C.rootIds.map(id => chip(ctx, id, 'big')).join('')}</div>
        <h3 class="sec">Or start from a branch</h3><div class="chips">${['musculocut', 'axillary', 'radial', 'median', 'ulnar', 'thoraco', 'longThoracic', 'suprascap'].map(id => chip(ctx, id)).join('')}</div>`;
    } else {
      h = `<h2 class="sname">Tap a structure to begin</h2><p class="muted">Turn layers on and off from the Layers button to build the specimen up or strip it down. Tap any nerve or label to see its root values, what it supplies and why it matters clinically.</p>
        <h3 class="sec">Good places to start</h3><div class="chips">${['upperTrunk', 'latCord', 'postCord', 'median', 'radial', 'ulnar'].map(id => chip(ctx, id)).join('')}</div>
        <h3 class="sec">Colours</h3>${legendHTML(ctx, this.pal)}` + this.sectionHTML();
    }
    this.body.innerHTML = h;
  }
  private setSheet(s: 'open' | 'peek') { this.sheet.dataset.state = s; }

  /* ---------- selection, steps, modes ---------- */
  select(id: string | null, opt: { focus?: boolean; centre?: Vector3 } = {}) {
    this.sel = id;
    if (this.mode === 'trace') this.traceSet = (id && this.S[id].layer === 'nerves') ? computeTrace(id, this.G) : null;
    this.updateTargets(); this.renderSheet();
    if (id) this.setSheet('open'); else if (this.mode !== 'dissect') this.setSheet('peek');
    if (!id) return;
    requestAnimationFrame(() => {
      this.layout();
      if (this.mode === 'trace' && this.traceSet && (opt.focus || opt.centre)) this.rig.focusOnSet([...this.traceSet].map(x => this.S[x]));
      else if (opt.focus) this.rig.focusOnSet([this.S[id]]);
      else if (opt.centre) this.rig.centreOn(opt.centre);
    });
  }
  goStep(n: number, how: 'jump' | 'next') {
    if (this.hands.on) this.handsStop(false);
    this.step = Math.max(0, Math.min(this.C.steps.length - 1, n));
    this.updateGuides();
    const st = this.C.steps[this.step];
    this.sel = null;
    this.done = !st.act || how === 'jump';
    this.setDT(this.stepVis()); if (how === 'jump') this.snapDP(); this.dissectDirty = true;
    this.updateTargets(); this.renderSheet(); this.body.scrollTop = 0; this.setSheet('open');
    requestAnimationFrame(() => { this.layout(); this.frameForStep(st, 900); });
  }
  /** Frame the structures of this step; use the end state so hidden ones are excluded. */
  private frameForStep(st: Step, dur: number) {
    const end = endState(this.C.steps, this.step);
    const items = st.find.filter(id => this.S[id] && !end.hide.includes(id) && this.S[id].meshes.length).map(id => this.S[id]);
    this.rig.frameStep(st.view, items, dur);
  }
  doAction() { this.done = true; this.setDT(this.stepVis()); this.updateTargets(); this.renderSheet(); this.noteStep(this.C.steps[this.step].key); }
  private noteStep(key: string) { this.progress = recordStep(this.progress, key); this.saveProgress(); }
  private saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress)); } catch { /* private mode */ } this.renderProgress(); }
  replay() {
    this.done = false; this.setDT(this.stepVis()); this.snapDP(); this.dissectDirty = true; this.updateTargets();
    setTimeout(() => { this.done = true; this.setDT(this.stepVis()); this.updateTargets(); this.renderSheet(); }, 350);
  }
  setMode(m: Mode) {
    if (this.hands.on) this.handsStop(false);
    const prev = this.mode; this.mode = m; this.traceSet = null; this.updateGuides();
    el('toolbar').hidden = m !== 'explore'; if (m !== 'explore') this.setTool('turn');
    document.querySelectorAll<HTMLButtonElement>('.modes button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
    this.applyColors(); this.updateLayersNote(); this.syncMarkers();
    if (m !== 'spotter') { this.spotter.session = null; this.spotter.summary = null; this.spotter.ghost = new Set(); this.pin.hidden = true; }
    if (prev === 'dissect' && m !== 'dissect') { this.sel = null; this.setDT(null); this.snapDP(); this.dissectDirty = true; this.rig.framePreset('home'); }
    if (m === 'dissect' && prev !== 'dissect') { this.spec.resetMasks(); this.removed.clear(); this.undoStack = []; el<HTMLButtonElement>('btnUndo').disabled = true; }
    if (m === 'lesion') { this.sel = null; this.order.forEach(d => { if (d.layer === 'skin') { d.cur = 0; this.spec.applyVis(d); } }); this.updateTargets(); this.renderSheet(); this.setSheet('open'); return; }
    if (m === 'dissect') { this.sel = null; this.goStep(this.step, 'jump'); return; }
    if (m === 'spotter') { this.sel = null; this.updateTargets(); this.renderSheet(); this.setSheet('open'); return; }
    if (m === 'trace' && this.sel && this.S[this.sel].layer === 'nerves') { this.traceSet = computeTrace(this.sel, this.G);
      const ids = [...this.traceSet]; requestAnimationFrame(() => { this.layout(); this.rig.focusOnSet(ids.map(x => this.S[x])); }); }
    this.updateTargets(); this.renderSheet();
    this.setSheet(this.sel || m === 'trace' ? 'open' : 'peek');
  }

  /* ---------- hands-on ---------- */
  private handsFrom() { return this.step > 0 ? endState(this.C.steps, this.step - 1) : initialState(); }
  private updateGuides() { const inc = this.S.incisions; if (inc && inc.guides) inc.guides.forEach(g => { g.visible = this.mode === 'dissect' && this.hands.on && isIncisionStep(this.C.steps[this.step]); }); }
  handsStart() {
    this.handsLast = null;
    // Resume from whatever is already cut into the skin, by hand or by the step itself.
    const mk = this.spec.masks.skin; const inc = isIncisionStep(this.C.steps[this.step]); this.covered = new Set();
    if (mk && inc) { this.guidePoints().forEach((g, i) => { if (mk.hasLineAt(g.p)) this.covered!.add(i); }); this.incPaintedSet.clear(); }
    const q0 = inc && this.covered.size ? Math.min(0.99, this.covered.size / (this.guidePoints().length * 0.8)) : 0;
    this.hands = { on: true, q: 0, last: null }; this.rig.controls.enabled = false; this.rig.cancelFly(); this.sel = null; this.setHandsQ(q0); this.updateGuides(); this.renderSheet();
  }
  handsStop(render = true) { this.hands.on = false; this.hands.last = null; this.rig.controls.enabled = true; this.updateGuides(); this.knife.hidden = true; if (render) this.renderSheet(); }
  private setHandsQ(q: number) {
    q = Math.max(0, Math.min(1, q)); this.hands.q = q;
    this.setDT(blendState(this.handsFrom(), endState(this.C.steps, this.step), q));
    this.snapDP(); this.dissectDirty = true; this.updateTargets();
    if (q >= 1) { this.handsStop(); this.doAction(); return; }
    const bar = document.getElementById('handsBar'); if (bar) bar.style.width = (q * 100).toFixed(1) + '%';
    const hint = document.getElementById('handsHint'); if (hint) hint.textContent = this.handsHint();
  }
  private handsHint(): string {
    const st = this.C.steps[this.step];
    if (!isIncisionStep(st)) return st.hand || 'Drag across the specimen.';
    const pct = Math.round(this.hands.q * 100);
    return `Draw the four incisions along the white guide lines: ${this.C.incisionNames.join('; ')}. ${pct}% cut. Turn the specimen with the Stop button if a line runs out of view.`;
  }
  private nextCutPoint() {
    const inc = this.S.incisions; if (!inc || !inc.lines) return null;
    const n = inc.lines.length; let base = 0;
    for (let k = 0; k < n; k++) { const pts = inc.lines[k], N = pts.length; for (let i = 0; i < N; i++) if (!this.covered || !this.covered.has(base + i)) return { k, n, idx: i, pts, N }; base += N; }
    return null;
  }
  private tmpV = new Vector3();
  /** Guide points of the incision lines already covered by the student's strokes. */
  private covered: Set<number> | null = null;
  private handsLast: Vector3 | null = null;
  private handsTrack(x: number, y: number, isDown: boolean) {
    if (isIncisionStep(this.C.steps[this.step])) {
      // Draw freely on the skin; the step completes when every guide point has been cut near enough.
      const inc = this.S.incisions; if (!inc || !inc.lines) return;
      const hit = this.picker.pick(x, y, true); if (!hit || hit.d.shellKey !== 'skin') { this.handsLast = null; return; }
      const mk = this.spec.masks.skin; if (mk) mk.stroke(this.handsLast && !isDown ? [this.handsLast, hit.point] : [hit.point], App.INCISION_R, 'line', false);
      const samples: Vector3[] = [hit.point]; if (this.handsLast && !isDown) { const n = Math.ceil(this.handsLast.distanceTo(hit.point) / 0.4); for (let s = 1; s < n; s++) samples.push(this.handsLast.clone().lerp(hit.point, s / n)); }
      this.handsLast = hit.point.clone();
      if (!this.covered) this.covered = new Set();
      const total = inc.lines.reduce((a, l) => a + l.length, 0); let base = 0;
      for (const line of inc.lines) { for (let i = 0; i < line.length; i++) { const g = base + i; if (this.covered.has(g)) continue; for (const s of samples) if (s.distanceToSquared(line[i]) < 1.5 * 1.5) { this.covered.add(g); break; } } base += line.length; }
      // Parts of the guide lines face away from the camera; cutting most of them completes the step.
      this.setHandsQ(Math.min(1, this.covered.size / (total * 0.8)));
    } else {
      const l = this.hands.last; if (!l) return; const d = Math.hypot(x - l.x, y - l.y); this.hands.last = { x, y };
      if (!isDown) this.setHandsQ(this.hands.q + d / (Math.min(this.rig.view.W, this.rig.view.H) * 1.1));
    }
  }

  /* ---------- lesions ---------- */
  setLesion(L: Lesion | null) {
    if (!L) { this.lesion = { active: null, result: null }; this.syncMarkers(); this.applyColors(); this.updateTargets(); this.renderSheet(); return; }
    const r = computeLesion(L, { G: this.G, nerves: this.C.nerves, muscles: this.C.muscles, sensory: this.C.sensory });
    this.lesion = { active: L, result: r }; this.sel = null;
    if (!L.custom) { this.progress = recordLesion(this.progress, L.id); this.saveProgress(); }
    this.syncMarkers(); this.applyColors(); this.updateTargets(); this.renderSheet(); this.body.scrollTop = 0; this.setSheet('open');
    requestAnimationFrame(() => { this.layout(); this.rig.focusOnSet(r.atIds.concat(Object.keys(r.status).filter(id => this.S[id].key)).map(id => this.S[id])); });
  }
  private syncMarkers() {
    const pts = (this.mode === 'lesion' && this.lesion.active) ? this.lesion.active.at.map(([id, u]) => this.S[id].curve!.getPoint(Math.min(.999, u))) : [];
    this.markers.forEach(m => { m.visible = false; });
    pts.forEach((p, i) => {
      if (!this.markers[i]) { const m = new Mesh(new SphereGeometry(.62, 20, 14), new MeshStandardMaterial({ color: '#E5484D', emissive: '#B3261E', emissiveIntensity: .7, transparent: true, opacity: .92 })); m.renderOrder = 4; this.gfx.scene.add(m); this.markers[i] = m; }
      this.markers[i].position.copy(p); this.markers[i].visible = true;
    });
  }

  /* ---------- spotter ---------- */
  private currentQuestion(): Question | null { const sp = this.spotter; return sp.session && !sp.summary ? sp.session[sp.i] : null; }
  private saveBox() { try { localStorage.setItem(BOX_KEY, JSON.stringify(this.spotter.box)); } catch { /* private mode */ } }
  spotterStart(n: number) {
    this.spotter.ghost = new Set();
    const pool = this.spec.spotterPool(this.layers);
    const session = buildSession(pool, this.C.byId, this.spotter.box, { n, now: Date.now() });
    Object.assign(this.spotter, { session, i: 0, chosen: null, attempts: [], summary: null }); this.sel = null;
    this.updateTargets(); this.renderSheet(); this.setSheet('open'); this.spotterFrame();
  }
  private spotterFrame() { const q = this.currentQuestion(); if (!q) return; requestAnimationFrame(() => { this.layout(); this.rig.focusOnSet([this.S[q.targetId]], 700); }); }
  spotterAnswer(k: number) {
    const q = this.currentQuestion(); if (!q || this.spotter.chosen != null) return;
    const ok = grade(q, k), now = Date.now();
    this.spotter.chosen = k; this.spotter.attempts.push({ targetId: q.targetId, kind: q.kind, correct: ok, at: now });
    this.spotter.box = updateBox(this.spotter.box, q.targetId, ok, now); this.saveBox();
    this.updateTargets(); this.renderSheet();
  }
  spotterNext() {
    const sp = this.spotter; if (!sp.session) return;
    if (sp.i + 1 < sp.session.length) { sp.i++; sp.chosen = null; this.sel = null; sp.ghost = new Set(); this.updateTargets(); this.renderSheet(); this.spotterFrame(); }
    else { sp.summary = summarise(sp.attempts); this.pin.hidden = true; this.progress = recordSpotter(this.progress, sp.summary); this.saveProgress(); this.updateTargets(); this.renderSheet(); }
  }
  /** Structures between the camera and the pinned anchor are ghosted so the pin is never on a hidden structure. */
  private spotterGhost(q: Question) {
    const target = this.S[q.targetId];
    const ids = this.picker.occludingIds(target.anchor, target, this.spec.occluders());
    const next = new Set(ids);
    if (next.size === this.spotter.ghost.size && [...next].every(x => this.spotter.ghost.has(x))) return;
    this.spotter.ghost = next; this.updateTargets();
  }
  spotterStop() { Object.assign(this.spotter, { session: null, summary: null, chosen: null }); this.pin.hidden = true; this.updateTargets(); this.renderSheet(); }

  /* ---------- UI wiring ---------- */
  private bindUI() {
    const canvas = this.canvas; const pointers = new Set<number>(); let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', e => { pointers.add(e.pointerId);
      if (this.mode === 'explore' && this.tool !== 'turn') { this.toolDown(e.clientX, e.clientY); down = null; return; }
      if (this.hands.on) { this.hands.last = { x: e.clientX, y: e.clientY }; this.handsTrack(e.clientX, e.clientY, true); down = null; return; }
      down = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
    canvas.addEventListener('pointermove', e => { this.hoverMove = { x: e.clientX, y: e.clientY }; if (this.stroke) { this.pointerMove = { x: e.clientX, y: e.clientY }; return; } if (this.hands.on && this.hands.last) this.handsTrack(e.clientX, e.clientY, false); });
    canvas.addEventListener('pointerleave', () => { this.hoverMove = null; this.setHover(null); if (this.cursorRing) this.cursorRing.visible = false; });
    canvas.addEventListener('dblclick', e => { const hit = this.picker.pick(e.clientX, e.clientY); if (!hit) return; const off = this.gfx.camera.position.clone().sub(this.rig.controls.target).multiplyScalar(0.55); this.rig.flyTo(hit.point, hit.point.clone().add(off), 500); });
    canvas.addEventListener('pointerup', e => { pointers.delete(e.pointerId);
      if (this.stroke) { if (this.pointerMove) { this.toolMove(this.pointerMove.x, this.pointerMove.y); this.pointerMove = null; } this.spec.masks[this.stroke.d.id]?.endStroke(); this.stroke = null; return; }
      if (this.pendingRemove) { const p = this.pendingRemove; this.pendingRemove = null; if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) this.removeStructure(p.d); return; }
      if (this.hands.on) { this.hands.last = null; down = null; return; }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 450) this.onPick(e.clientX, e.clientY);
      down = null; });
    canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); down = null; this.stroke = null; this.pendingRemove = null; });
    document.querySelectorAll<HTMLButtonElement>('#toolbar [data-tool]').forEach(b => b.addEventListener('click', () => this.setTool(b.dataset.tool as Tool)));
    el('btnUndo').addEventListener('click', () => this.undo());
    el('btnResetDissection').addEventListener('click', () => this.resetDissection());
    document.querySelectorAll<HTMLButtonElement>('#segSection button').forEach(b => b.addEventListener('click', () => {
      const ax = b.dataset.axis; this.section.axis = ax === 'off' ? null : (ax as SectionAxis);
      document.querySelectorAll<HTMLButtonElement>('#segSection button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      this.applySection();
    }));
    el<HTMLInputElement>('sectionPos').addEventListener('input', e => { this.section.t = Number((e.target as HTMLInputElement).value) / 100; this.applySection(); });
    el('sectionFlip').addEventListener('click', () => { this.section.flip = !this.section.flip; this.applySection(); });
    el('progressBox').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!b) return;
      if (b.dataset.act === 'pexport') this.exportProgress();
      else if (b.dataset.act === 'pimport') el<HTMLInputElement>('progressFile').click();
      else if (b.dataset.act === 'pclear') { this.progress = emptyProgress(this.progress.student.name); this.saveProgress(); }
    });
    el('progressBox').addEventListener('change', e => {
      const t = e.target as HTMLInputElement; if (t.id === 'pname') { this.progress = { ...this.progress, student: { ...this.progress.student, name: t.value.slice(0, 60) } }; this.saveProgress(); }
    });
    el<HTMLInputElement>('progressFile').addEventListener('change', async () => {
      const f = el<HTMLInputElement>('progressFile').files?.[0]; el<HTMLInputElement>('progressFile').value = ''; if (!f) return;
      try { this.progress = parseProgress(await f.text()); this.saveProgress(); this.toast('Progress imported.'); } catch { this.toast('That file is not a progress export.'); }
    });

    this.sheet.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sel],[data-act],[data-les]'); if (!b) return;
      if (b.dataset.les) { this.setLesion(this.C.lesions.find(x => x.id === b.dataset.les) || null); return; }
      if (b.dataset.sel) { this.select(b.dataset.sel, { focus: true }); return; }
      const a = b.dataset.act;
      if (a === 'close') this.select(null);
      else if (a === 'focus' && this.sel) { if (this.mode === 'trace' && this.traceSet) this.rig.focusOnSet([...this.traceSet].map(x => this.S[x])); else this.rig.focusOnSet([this.S[this.sel]]); }
      else if (a === 'trace') this.setMode('trace');
      else if (a === 'prev') this.goStep(this.step - 1, 'jump');
      else if (a === 'next') { const st = this.C.steps[this.step]; if (!st.act) this.noteStep(st.key); this.goStep(this.step === this.C.steps.length - 1 ? 0 : this.step + 1, this.step === this.C.steps.length - 1 ? 'jump' : 'next'); }
      else if (a === 'do') { if (this.hands.on) this.handsStop(); this.doAction(); }
      else if (a === 'hands') this.handsStart();
      else if (a === 'stop') this.handsStop();
      else if (a === 'replay') this.replay();
      else if (a === 'lclear') this.setLesion(null);
      else if (a === 'pview') { const v = el<HTMLElement>('photoViewer'); const img = v.querySelector('img')!; img.src = b.dataset.src || ''; v.hidden = false; }
      else if (a === 'sp-start') this.spotterStart(Number(b.dataset.n) || 10);
      else if (a === 'sp-answer') this.spotterAnswer(Number(b.dataset.k));
      else if (a === 'sp-next') this.spotterNext();
      else if (a === 'sp-stop') this.spotterStop();
      else if (a === 'sp-reset') { this.spotter.box = {}; this.saveBox(); this.renderSheet(); }
    });
    el('photoViewer').addEventListener('click', () => { el('photoViewer').hidden = true; });
    el('grab').addEventListener('click', () => this.setSheet(this.sheet.dataset.state === 'open' ? 'peek' : 'open'));
    document.querySelectorAll<HTMLButtonElement>('.modes button').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode)));
    el('btnReset').addEventListener('click', () => { if (this.mode === 'dissect') this.frameForStep(this.C.steps[this.step], 750); else this.rig.framePreset('home'); });

    const pops: Record<string, [HTMLElement, HTMLElement]> = { layers: [el('btnLayers'), el('layersPop')], help: [el('btnHelp'), el('helpPop')] };
    const togglePop = (k: string | null, force?: boolean) => {
      Object.entries(pops).forEach(([n, [btn, pop]]) => { const open = n === k ? (force == null ? pop.hidden : force) : false; pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
      this.updateLayersNote();
    };
    pops.layers[0].addEventListener('click', e => { e.stopPropagation(); togglePop('layers'); });
    pops.help[0].addEventListener('click', e => { e.stopPropagation(); togglePop('help'); });
    document.addEventListener('click', e => { const t = e.target as HTMLElement; if (!t.closest('.pop') && !t.closest('.icon')) togglePop(null); });
    document.querySelectorAll<HTMLButtonElement>('#segLayers button').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.layer as Layer; this.layers[k] = !this.layers[k]; b.setAttribute('aria-pressed', String(this.layers[k]));
      if (this.sel && this.S[this.sel].layer === k && !this.layers[k]) this.sel = null;
      this.updateTargets(); this.renderSheet();
    }));
    document.querySelectorAll<HTMLButtonElement>('#segLabels button').forEach(b => b.addEventListener('click', () => {
      this.labelMode = b.dataset.labels as typeof this.labelMode;
      document.querySelectorAll<HTMLButtonElement>('#segLabels button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      this.labels.dirty = true;
    }));
    document.querySelectorAll<HTMLButtonElement>('#segColor button').forEach(b => b.addEventListener('click', () => { this.colorBy[this.mode] = b.dataset.color as PaletteMode; this.applyColors(); this.renderSheet(); }));

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { togglePop(null); return; }
      const t = e.target as HTMLElement; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const cam = this.gfx.camera, ctl = this.rig.controls;
      const orbit = (dTheta: number, dPhi: number) => { const sp = new Spherical().setFromVector3(cam.position.clone().sub(ctl.target)); sp.theta += dTheta; sp.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sp.phi + dPhi)); cam.position.setFromSpherical(sp).add(ctl.target); ctl.update(); this.labels.dirty = true; };
      const dolly = (f: number) => { const v = cam.position.clone().sub(ctl.target).multiplyScalar(f); cam.position.copy(ctl.target).add(v); ctl.update(); this.labels.dirty = true; };
      if (e.key === 'ArrowLeft') orbit(-0.08, 0); else if (e.key === 'ArrowRight') orbit(0.08, 0);
      else if (e.key === 'ArrowUp') orbit(0, -0.06); else if (e.key === 'ArrowDown') orbit(0, 0.06);
      else if (e.key === '+' || e.key === '=') dolly(0.9); else if (e.key === '-') dolly(1.1);
      else if (this.mode === 'explore' && (e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) this.undo();
      else if (this.mode === 'explore' && e.key === '1') this.setTool('turn'); else if (this.mode === 'explore' && e.key === '2') this.setTool('scalpel'); else if (this.mode === 'explore' && e.key === '3') this.setTool('lift');
      else if (this.mode === 'dissect' && (e.key === 'n' || e.key === 'N')) { if (this.done) this.goStep(Math.min(this.step + 1, this.C.steps.length - 1), 'next'); else this.doAction(); }
      else if (this.mode === 'dissect' && (e.key === 'p' || e.key === 'P')) this.goStep(this.step - 1, 'jump');
      else return;
      e.preventDefault();
    });
  }
  private updateLayersNote() {
    el('layersNote').textContent = this.mode === 'dissect' ? 'In Dissect, the steps decide which layers are shown. Colours still apply.' : (this.mode === 'lesion' ? 'In Lesion, muscles and bones are always shown. Colours still apply.' : '');
  }
  private onPick(x: number, y: number) {
    const hit = this.picker.pick(x, y);
    if (!hit) { if (this.mode !== 'spotter' || this.spotter.chosen != null) this.select(null); return; }
    if (this.mode === 'spotter' && this.currentQuestion() && this.spotter.chosen == null) return;
    if (this.mode === 'lesion' && hit.d.layer === 'nerves') { this.setLesion(customLesion(hit.d.id, hit.d.name, curveParamNear(hit.d, hit.point))); return; }
    this.select(hit.d.id, { centre: hit.point });
  }

  /* ---------- free dissection tools ---------- */
  setTool(t: Tool) {
    const prev = this.tool;
    this.tool = t; this.rig.controls.enabled = t === 'turn'; this.stroke = null; this.pendingRemove = null;
    document.querySelectorAll<HTMLButtonElement>('#toolbar [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    this.canvas.dataset.tool = t;
    if (t !== prev) {
      if (t === 'scalpel') this.toast('Scalpel: draw your incisions on the skin. Close the outline, then switch to Lift to turn the flap back.', 4600);
      if (t === 'lift') this.toast('Lift: click inside an outlined flap to lift it off. Drag over fat or fascia to pick it away. Click a muscle, vessel or bone to remove it.', 5200);
    }
    if (this.cursorRing) this.cursorRing.visible = false;
  }
  private pushUndo(label: string, undo: () => void) { this.undoStack.push({ label, undo }); if (this.undoStack.length > 40) this.undoStack.shift(); el<HTMLButtonElement>('btnUndo').disabled = false; }
  undo() {
    const u = this.undoStack.pop(); if (!u) return; u.undo(); this.updateTargets(); this.labels.dirty = true;
    el<HTMLButtonElement>('btnUndo').disabled = this.undoStack.length === 0; this.toast(`Undid: ${u.label}`);
  }
  resetDissection() {
    this.spec.resetMasks(); this.removed.clear(); this.undoStack = []; el<HTMLButtonElement>('btnUndo').disabled = true;
    for (const d of this.order) if (d.fold && d.lift) { this.DP.fold[d.id] = 0; this.DT.fold[d.id] = 0; }
    this.dissectDirty = true; this.updateTargets(); this.toast('Specimen restored.');
  }
  private removeStructure(d: RT) {
    if (d.shellKey) { this.toast('Outline a flap with the scalpel, then lift inside it.'); return; }
    this.removed.add(d.id); if (this.sel === d.id) this.sel = null;
    this.pushUndo(`remove ${d.name.toLowerCase()}`, () => { this.removed.delete(d.id); });
    this.updateTargets(); this.toast(`${d.name} removed.`);
  }
  /** Brush radius for picking tissue away, scaled so it stays about the same size on screen. */
  private brushRadius() { return Math.max(1.0, this.gfx.camera.position.distanceTo(this.rig.controls.target) * 0.03); }
  private static INCISION_R = 0.13;
  private toolDown(x: number, y: number) {
    const hit = this.picker.pick(x, y, true);
    if (!hit) return;
    const d = hit.d, mk = d.shellKey ? this.spec.masks[d.id] : null;
    if (this.tool === 'scalpel') {
      if (!mk) { this.toast(d.shellKey ? 'The skin layers are still being prepared.' : 'The scalpel cuts the skin layers. Use Lift to remove deeper structures.'); return; }
      this.pushUndo(`incision on ${d.name.toLowerCase()}`, () => mk.undo());
      mk.stroke([hit.point], App.INCISION_R, 'line'); this.stroke = { d, last: hit.point.clone(), channel: 'line', r: App.INCISION_R }; return;
    }
    // lift
    if (!mk) { this.pendingRemove = { d, x, y }; return; }
    if (d.shellKey === 'skin') {
      const n = mk.fill(hit.point, hit.normal);
      if (n === -1) { this.toast('This flap is not outlined. Draw a closed incision with the scalpel first, then lift inside it.', 4200); return; }
      if (n === 0) { this.toast('Nothing to lift here.'); return; }
      this.pushUndo('lift skin flap', () => mk.undo()); this.toast('Skin flap lifted.'); return;
    }
    this.pushUndo(`pick away ${d.name.toLowerCase()}`, () => mk.undo());
    const r = this.brushRadius(); mk.stroke([hit.point], r, 'cut'); this.stroke = { d, last: hit.point.clone(), channel: 'cut', r };
  }
  private toolMove(x: number, y: number) {
    if (!this.stroke) return;
    const hit = this.picker.pick(x, y, true); if (!hit || hit.d !== this.stroke.d) return;
    const mk = this.spec.masks[hit.d.id]; if (!mk) return;
    mk.stroke([this.stroke.last, hit.point], this.stroke.r, this.stroke.channel); this.stroke.last = hit.point.clone();
  }
  /** Hover: a ring on the surface for the cutting tools, a soft glow on the structure under the pointer. */
  private updateHover() {
    if (this.mode !== 'explore') { if (this.cursorRing) this.cursorRing.visible = false; return; }
    const hm = this.hoverMove; if (!hm) return; // nothing moved: keep the ring where it was
    this.hoverMove = null;
    const hit = this.picker.pick(hm.x, hm.y, this.tool !== 'turn');
    if (this.tool === 'turn') { this.setHover(hit ? hit.d.id : null); if (this.cursorRing) this.cursorRing.visible = false; return; }
    this.setHover(null);
    if (!this.cursorRing) { const ring = new Mesh(new RingGeometry(0.78, 1, 48), new MeshBasicMaterial({ color: 0xf0c53e, depthTest: false, side: 2 })); const edge = new Mesh(new RingGeometry(0.7, 1.08, 48), new MeshBasicMaterial({ color: 0x14201d, transparent: true, opacity: 0.75, depthTest: false, side: 2 })); edge.renderOrder = 8; ring.add(edge); ring.renderOrder = 9; this.cursorRing = ring; this.gfx.scene.add(ring); }
    const ring = this.cursorRing;
    if (!hit) { ring.visible = false; return; }
    const r = this.tool === 'scalpel' || (hit.d.shellKey === 'skin') ? 0.9 : this.brushRadius();
    ring.visible = true; ring.scale.setScalar(r); ring.position.copy(hit.point).addScaledVector(hit.normal, 0.08); ring.lookAt(hit.point.clone().add(hit.normal));
  }
  private setHover(id: string | null) { if (id !== this.hoverId) { this.hoverId = id; this.canvas.style.cursor = id && this.tool === 'turn' ? 'pointer' : ''; } }
  private toastTimer = 0;
  toast(msg: string, ms = 2600) { const t = el('toast'); t.textContent = msg; t.hidden = false; clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => { t.hidden = true; }, ms); }

  /* ---------- section plane ---------- */
  applySection() {
    const s = this.section;
    this.renderSheet();
    if (!s.axis) { this.gfx.renderer.clippingPlanes = []; return; }
    const [lo, hi] = SECTION_RANGE[s.axis]; const at = lo + s.t * (hi - lo);
    const axis = new Vector3(s.axis === 'x' ? 1 : 0, s.axis === 'y' ? 1 : 0, s.axis === 'z' ? 1 : 0);
    const camSide = Math.sign(this.gfx.camera.position.dot(axis) - at) || 1;
    // Keep the half away from the camera (so the cut face is what you see); Flip keeps the near half instead.
    const n = axis.clone().multiplyScalar(-camSide * (s.flip ? -1 : 1));
    const p = axis.clone().multiplyScalar(at);
    this.gfx.renderer.clippingPlanes = [new Plane(n, -n.dot(p))];
  }

  /** Visible Human slice matching the current section plane, or a note when the data is not installed. */
  private sectionHTML(): string {
    const s = this.section; if (!s.axis || this.mode !== 'explore') return '';
    const [lo, hi] = SECTION_RANGE[s.axis]; const at = lo + s.t * (hi - lo);
    if (!this.vh) return `<hr><h3 class="sec">Real section at this level</h3><p class="muted small">Visible Human slices are not installed. Run <code>python3 tools/fetch-visible-human.py</code> once to add them.</p>`;
    const sl = sliceFor(this.vh, s.axis, at);
    return `<hr><h3 class="sec">Real section at this level</h3>
      <figure class="photo vh"><button class="photo-btn" data-act="pview" data-src="${sl.src}" aria-label="Enlarge section"><img src="${sl.src}" alt="Visible Human cryosection, ${sl.level}"></button>
      <figcaption>${sl.caption} <span class="muted">Photograph of a real cadaver section from the Visible Human Project (U.S. National Library of Medicine, public domain). A different body from the model, so the match is approximate.</span></figcaption></figure>`;
  }

  /* ---------- progress ---------- */
  renderProgress() {
    const box = document.getElementById('progressBox'); if (!box) return;
    const s = stats(this.progress, this.C.steps.length), name = this.progress.student.name;
    const weak = s.weakest.map(w => `${this.S[w.id]?.name || w.id} (${w.misses})`).join(', ');
    box.innerHTML = `<label class="sec" for="pname">Your name</label><input id="pname" class="pinput" maxlength="60" value="${name.replace(/"/g, '&quot;')}" placeholder="So your teacher knows whose file this is">
      <p>Dissection steps completed: <b>${s.stepsDone} of ${s.totalSteps}</b>. Spotter sessions: <b>${s.spotterSessions}</b>${s.spotterAccuracy != null ? `, accuracy <b>${s.spotterAccuracy}%</b>` : ''}.</p>
      ${weak ? `<p class="muted small">Most missed: ${weak}</p>` : ''}
      <div class="actions"><button class="btn" data-act="pexport">Export for your teacher</button><button class="btn" data-act="pimport">Import</button><button class="btn" data-act="pclear">Clear</button></div>`;
  }
  exportProgress() {
    const blob = new Blob([JSON.stringify(this.progress, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `progress-${(this.progress.student.name || this.progress.student.id).replace(/[^\w-]+/g, '_')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- frame loop ---------- */
  private frame(now: number) {
    const dt = Math.min(.05, (now - this.last) / 1000); this.adaptResolution(now - this.last); this.last = now;
    if (this.rig.tick(now)) this.labels.dirty = true;
    this.stepDissect(dt);
    if (this.mode === 'dissect' && this.spec.built) this.updateTargetsLite();
    for (const d of this.order) {
      if (d.cur !== d.target) {
        d.cur += (d.target - d.cur) * Math.min(1, dt * 6);
        if (Math.abs(d.target - d.cur) < .003) d.cur = d.target;
        this.spec.applyVis(d); this.labels.dirty = true;
      }
    }
    const pulse = this.reduceMotion ? .42 : .36 + .2 * Math.sin(now / 260);
    this.markers.forEach(m => { if (m.visible) m.scale.setScalar(1 + (this.reduceMotion ? 0 : .18 * Math.sin(now / 200))); });
    for (const d of this.order) {
      let e = d.eBase || 0;
      if (this.sel === d.id) e = pulse; else if (this.emph.has(d.id)) e = pulse * .85; else if (this.traceSet && this.traceSet.has(d.id)) e = .16; else if (this.hoverId === d.id) e = Math.max(e, .14);
      d.mat.emissive.copy(d.mat.color).multiplyScalar(e);
    }
    const v = this.rig.view;
    if (this.hands.on && isIncisionStep(this.C.steps[this.step])) { const c = this.nextCutPoint();
      if (c) { const j = c.idx; this.tmpV.copy(c.pts[j]).project(this.gfx.camera); this.knife.hidden = false;
        this.knife.style.transform = `translate(${((this.tmpV.x + 1) / 2 * v.W).toFixed(1)}px,${((1 - this.tmpV.y) / 2 * v.H).toFixed(1)}px)`; } else this.knife.hidden = true;
    } else if (!this.knife.hidden) this.knife.hidden = true;
    const q = this.currentQuestion();
    if (q) { this.tmpV.copy(this.S[q.targetId].anchor).project(this.gfx.camera); this.pin.hidden = this.tmpV.z > 1;
      this.pin.style.transform = `translate(${((this.tmpV.x + 1) / 2 * v.W).toFixed(1)}px,${((1 - this.tmpV.y) / 2 * v.H).toFixed(1)}px)`; }
    else if (!this.pin.hidden) this.pin.hidden = true;
    if (q && this.labels.dirty) this.spotterGhost(q);
    if (this.pointerMove) { const pm = this.pointerMove; this.pointerMove = null; this.toolMove(pm.x, pm.y); }
    this.updateHover(); this.spec.flushMasks();
    if (this.labels.dirty) this.labels.update(this.labelIds(), this.labelPriority, this.sel, v, () => this.spec.occluders(), now);
    this.gfx.renderer.render(this.gfx.scene, this.gfx.camera);
    requestAnimationFrame(t => this.frame(t));
  }
  /** Incisions and landmarks follow the live skin state while a cut is animating. */
  private updateTargetsLite() {
    const inc = this.S.incisions; const vis = this.stepVis();
    if (inc && vis) { const on = this.DP.inc > 0 && this.DP.skin[0] < 0.02 && !vis.hide.includes('incisions'); inc.target = on ? 1 : 0; }
    for (const d of this.order) if (d.lm) d.target = this.DP.skin[0] < 0.02 ? 1 : 0;
  }
}
