import type { Content, Lesion, Root, Step } from '../content';
import type { RT } from '../engine/registry';
import type { LesionResult } from '../logic/lesion';
import type { Question, Summary } from '../logic/spotter';

export const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface HtmlCtx {
  C: Content;
  S: Record<string, RT>;
  dotColor: (d: RT) => string;
  famColor: (d: RT) => string;
  mode: string;
  traceSet: Set<string> | null;
}

export function chip(ctx: HtmlCtx, id: string, cls = ''): string {
  const d = ctx.S[id]; if (!d) return '';
  return `<button class="chip ${cls}" data-sel="${id}"><span class="dot" style="background:${ctx.dotColor(d)}"></span>${esc(d.label || d.name)}</button>`;
}

export function rootbar(ctx: HtmlCtx, d: RT): string {
  const c = ctx.famColor(d), roots = d.roots || [];
  return `<div class="rootbar" style="--sw:${c}" aria-label="Root values ${roots.join(', ')}">${ctx.C.palette.roots.map((r: Root) => `<span class="${roots.includes(r) ? 'on' : ''}">${r}</span>`).join('')}</div>`;
}

export const section = (t: string, txt?: string) => txt ? `<h3 class="sec">${t}</h3><p>${esc(txt)}</p>` : '';

export function infoHTML(ctx: HtmlCtx, d: RT, opt: { compact?: boolean } = {}): string {
  const sw = d.layer === 'nerves' ? ctx.famColor(d) : ctx.dotColor(d);
  let h = opt.compact ? '' : `<button class="close" data-act="close" aria-label="Close">×</button>`;
  h += `<p class="kicker"><span class="swatch" style="background:${sw}"></span>${esc(d.kind)}</p><h2 class="sname">${esc(d.name)}</h2>`;
  if (d.layer === 'nerves') { const r = d.roots!; h += rootbar(ctx, d) + `<p class="rootcap">Root values: ${r.length > 2 ? r[0] + '–' + r[r.length - 1] : r.join(', ')}</p>`; }
  const i = d.info || {};
  h += section(d.layer === 'nerves' ? 'Where it lies' : (d.kind === 'Surface landmark' ? 'What to feel' : 'Relations'), i.lies) + section('Supplies', i.supplies) + section('Skin', i.skin) + section('Clinical note', i.clinical);
  if (d.layer === 'nerves') {
    if (d.parents.length) h += `<h3 class="sec">Comes from</h3><div class="chips">${d.parents.map(p => chip(ctx, p)).join('')}</div>`;
    if (d.children.length) h += `<h3 class="sec">Gives</h3><div class="chips">${d.children.map(c => chip(ctx, c)).join('')}</div>`;
  }
  if (ctx.mode === 'trace' && ctx.traceSet && d.layer === 'nerves') {
    const reach = [...ctx.traceSet].filter(x => x !== d.id && ctx.S[x].children.length === 0 && ctx.S[x].kind !== 'Division');
    const from = [...ctx.traceSet].filter(x => ctx.S[x].kind === 'Root');
    if (d.kind !== 'Root' && from.length) h += `<h3 class="sec">Fibres come from</h3><div class="chips">${from.map(x => chip(ctx, x, 'big')).join('')}</div>`;
    if (reach.length) h += `<h3 class="sec">Fibres reach</h3><div class="chips">${reach.map(x => chip(ctx, x)).join('')}</div>`;
  }
  if (!opt.compact) {
    h += `<div class="actions">`;
    if (ctx.mode === 'explore' && d.layer === 'nerves') h += `<button class="btn primary" data-act="trace">Trace fibres</button>`;
    if (ctx.mode === 'trace') h += `<button class="btn primary" data-act="close">Clear trace</button>`;
    h += `<button class="btn" data-act="focus">Zoom to it</button></div>`;
  }
  return h;
}

export function legendHTML(ctx: HtmlCtx, palette: string): string {
  if (palette === 'classic') return `<p class="muted">All nerves are shown in atlas yellow.</p>`;
  if (palette === 'cadaver') return `<p class="muted">Cadaver colours: nerves are cream-white cords, as they look in the dissection hall. Switch to colours by cord in Layers.</p>`;
  return `<div class="legend">${Object.values(ctx.C.palette.families).map((f: { c: string; name: string }) => `<div><span class="swatch" style="background:${f.c}"></span>${esc(f.name)}</div>`).join('')}</div>`;
}

export function photoHTML(ctx: HtmlCtx, st: Step): string {
  const p = ctx.C.photos[st.key];
  if (!p) return `<h3 class="sec">Real specimen at this stage</h3><p class="muted">No specimen photo has been added for this step yet. Add one in <code>src/content/data/photos.json</code>.</p>`;
  let h = `<h3 class="sec">${p.kind === 'illustration' ? 'Reference plate for this stage' : 'Real specimen at this stage'}</h3>`;
  h += `<figure class="photo"><button class="photo-btn" data-act="pview" data-src="${esc(p.src)}" aria-label="Enlarge photo"><img src="${esc(p.src)}" alt="${esc(p.caption || st.title)}" loading="lazy"></button>
    <figcaption>${esc(p.caption || '')}${p.credit ? ` <span class="muted">${esc(p.credit)}</span>` : ''}</figcaption></figure>`;
  return h;
}

export function mapSVG(ctx: HtmlCtx, regions: Record<string, string>): string {
  const REG = ctx.C.skinMap.regions, LIMB = ctx.C.skinMap.limb;
  const layer = (back: boolean) => Object.keys(regions).map(id => { const s = REG[id] && REG[id][back ? 1 : 0]; if (!s) return '';
    const lost = regions[id] === 'lost'; return `<g fill="${lost ? '#D64545' : '#E59A3A'}" fill-opacity="${lost ? .62 : .5}">${s}</g>`; }).join('');
  const base = `<g class="limb">${LIMB}</g>`;
  return `<svg viewBox="0 0 320 314" role="img" aria-label="Map of skin sensation on the front and back of the right upper limb">
    <g transform="translate(20,0)">${base}${layer(false)}</g>
    <g transform="translate(300,0) scale(-1,1)">${base}${layer(true)}</g>
    <text x="80" y="310" text-anchor="middle" class="maplbl">Front (palm)</text><text x="240" y="310" text-anchor="middle" class="maplbl">Back</text>
    <text x="52" y="270" text-anchor="end" class="maplbl small">thumb</text><text x="268" y="270" class="maplbl small">thumb</text></svg>`;
}

export function lesionPicker(ctx: HtmlCtx): string {
  const groups = [...new Set(ctx.C.lesions.map(l => l.group))];
  return groups.map(g => `<p class="lgroup">${esc(g)}</p><div class="chips">${ctx.C.lesions.filter(l => l.group === g).map(l => `<button class="chip" data-les="${l.id}"><span class="dot" style="background:#E5484D"></span>${esc(l.name)}</button>`).join('')}</div>`).join('');
}

export function lesionHTML(ctx: HtmlCtx, L: Lesion | null, r: LesionResult | null): string {
  if (!L || !r) return `<h2 class="sname">Lesion simulator</h2><p class="muted">Pick a classic injury, or tap any nerve in the model to cut it at that point. Cut nerves turn grey, paralysed muscles turn grey-blue, and the skin map shows where feeling is lost.</p>${lesionPicker(ctx)}`;
  const regs = Object.keys(r.regions);
  const moves = L.moves || (r.para.length ? [...new Set(r.para.map(m => m.a))].join('; ') + '.' : 'No muscle is fully paralysed.');
  const reflex = L.reflex || (r.reflexes.length ? r.reflexes.join('; ') + '.' : 'No tendon reflex depends on the paralysed muscles.');
  let h = `<button class="close" data-act="lclear" aria-label="Clear lesion">×</button><p class="kicker"><span class="swatch" style="background:#E5484D"></span>Lesion</p><h2 class="sname">${esc(L.name)}</h2><p class="muted">${esc(L.site)}</p>`;
  h += section('Typical cause', L.cause) + section('What you see', L.sees) + section('Movements lost or weak', moves);
  h += `<h3 class="sec">Skin sensation</h3>`;
  h += regs.length ? `<div class="mapwrap">${mapSVG(ctx, r.regions)}</div><p class="mapcap">${r.mapMode === 'dermatomes' ? 'Dermatomes of the injured roots. ' : 'Areas supplied by the injured nerves. '}Red: feeling lost; orange: reduced. The map is schematic and real boundaries overlap.</p>` : `<p>No area of skin numbness is expected.</p>`;
  h += section('Reflexes', reflex) + section('Signs and tests', L.signs);
  if (r.para.length) h += `<h3 class="sec">Paralysed muscles (${r.para.length})</h3><ul class="mlist">${r.para.map(m => `<li><b>${esc(m.n)}</b> <span class="muted">${esc(m.a)}</span></li>`).join('')}</ul>`;
  if (r.weak.length) h += `<h3 class="sec">Weakened muscles (${r.weak.length})</h3><ul class="mlist">${r.weak.map(m => `<li><b>${esc(m.n)}</b> <span class="muted">${esc(m.a)}</span></li>`).join('')}</ul>`;
  h += `<div class="actions"><button class="btn primary" data-act="lclear">Pick another lesion</button></div>`;
  return h;
}

export interface SpotterView { session: Question[] | null; i: number; chosen: number | null; summary: Summary | null; dueCount: number; poolSize: number }

export function spotterHTML(ctx: HtmlCtx, v: SpotterView): string {
  if (!v.session) {
    return `<h2 class="sname">Spotter practice</h2><p class="muted">A pin lands on a structure and you name it, give its root values, what it supplies or where it comes from, as in the practical exam. Structures you miss come back sooner.</p>
      <p class="muted">Pool: ${v.poolSize} structures from the layers switched on${v.dueCount ? `, ${v.dueCount} due for review` : ''}.</p>
      <div class="actions"><button class="btn primary" data-act="sp-start" data-n="10">Start 10 pins</button><button class="btn" data-act="sp-start" data-n="20">20 pins</button><button class="btn" data-act="sp-reset">Forget my history</button></div>`;
  }
  if (v.summary) {
    const s = v.summary;
    let h = `<p class="kicker">Session complete</p><h2 class="sname">Spotter result</h2><div class="score"><b>${s.percent}%</b><span class="muted">${s.correct} of ${s.total} correct</span></div>`;
    if (s.missed.length) h += `<h3 class="sec">Review these</h3><div class="chips">${[...new Set(s.missed)].map(id => chip(ctx, id)).join('')}</div>`;
    else h += `<p>Every pin named correctly. These structures move to a longer review interval.</p>`;
    h += `<div class="actions"><button class="btn primary" data-act="sp-start" data-n="10">Another 10</button><button class="btn" data-act="sp-stop">Done</button></div>`;
    return h;
  }
  const q = v.session[v.i], answered = v.chosen != null;
  let h = `<p class="kicker">Pin ${v.i + 1} of ${v.session.length}</p><div class="progress">${v.session.map((_, k) => `<span class="${k <= v.i ? 'on' : ''}"></span>`).join('')}</div>
    <h2 class="sname" style="font-size:20px">${esc(answered ? q.prompt : q.prompt.replace(/\s*\(.*?\)/, ''))}</h2><div class="opts">`;
  q.options.forEach((o, k) => {
    const st = answered ? (k === q.answer ? 'right' : (k === v.chosen ? 'wrong' : '')) : '';
    h += `<button class="opt" data-act="sp-answer" data-k="${k}" data-state="${st}" ${answered ? 'disabled' : ''}>${esc(o)}</button>`;
  });
  h += `</div>`;
  if (answered) {
    const d = ctx.S[q.targetId];
    h += `<p class="${v.chosen === q.answer ? '' : 'err'}">${v.chosen === q.answer ? 'Correct.' : 'Not quite.'} The pin is on the <b>${esc(d.name)}</b>.</p>`;
    h += `<div class="actions"><button class="btn primary" data-act="sp-next">${v.i + 1 < v.session.length ? 'Next pin' : 'See result'}</button><button class="btn" data-sel="${q.targetId}">About it</button></div>`;
  } else h += `<div class="actions"><button class="btn" data-act="sp-stop">Stop</button></div>`;
  return h;
}
