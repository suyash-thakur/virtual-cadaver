import type { Content } from '../content';
import { esc } from './html';

/** Readable lesson shown when WebGL is not available: every step, its structures and the lesion library. */
export function renderFallback(el: HTMLElement, C: Content, reason: string) {
  const name = (id: string) => { const s = C.byId[id] || (C.surfaces[id] ? { name: C.surfaces[id].name } : null); return s ? s.name : id; };
  let h = `<div class="wrap"><h1>Brachial plexus</h1><p class="notice">${esc(reason)} The 3D specimen needs WebGL. Here is the dissection as a reading lesson instead.</p>`;
  h += `<h2>Dissection, step by step</h2><ol>`;
  for (const st of C.steps) h += `<li><b>${esc(st.title)}</b><br>${esc(st.text)}<br><span class="muted">Find: ${st.find.map(name).map(esc).join(', ')}</span></li>`;
  h += `</ol><h2>Nerves</h2>`;
  for (const n of C.nerves) {
    h += `<h3>${esc(n.name)} <span class="muted">(${n.roots.join(', ')})</span></h3>`;
    const i = n.info || {};
    if (i.lies) h += `<p>${esc(i.lies)}</p>`; if (i.supplies) h += `<p><b>Supplies:</b> ${esc(i.supplies)}</p>`; if (i.skin) h += `<p><b>Skin:</b> ${esc(i.skin)}</p>`; if (i.clinical) h += `<p><b>Clinical:</b> ${esc(i.clinical)}</p>`;
  }
  h += `<h2>Lesions</h2>`;
  for (const L of C.lesions) h += `<h3>${esc(L.name)}</h3><p class="muted">${esc(L.site)}</p>${L.cause ? `<p><b>Cause:</b> ${esc(L.cause)}</p>` : ''}${L.sees ? `<p><b>What you see:</b> ${esc(L.sees)}</p>` : ''}${L.signs ? `<p><b>Signs:</b> ${esc(L.signs)}</p>` : ''}`;
  h += `</div>`;
  el.innerHTML = h; el.hidden = false;
}
