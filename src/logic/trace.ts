import type { NerveNode } from '../content';

export type NerveGraph = Record<string, NerveNode>;

/**
 * Every nerve whose fibres are shared with `id`: ancestors and descendants that carry at
 * least one of the same root values. Returns a set that always includes `id`.
 */
export function computeTrace(id: string, G: NerveGraph): Set<string> {
  const s = G[id];
  if (!s) throw new Error(`unknown nerve ${id}`);
  const rs = new Set(s.roots);
  const out = new Set([id]);
  const seen = new Set([id]);
  const shares = (x: string) => G[x].roots.some(r => rs.has(r));
  let q = s.parents.slice();
  while (q.length) { const p = q.shift()!; if (seen.has(p)) continue; seen.add(p); if (shares(p)) out.add(p); q.push(...G[p].parents); }
  q = s.children.slice();
  while (q.length) { const c = q.shift()!; if (seen.has(c)) continue; seen.add(c); if (shares(c)) out.add(c); q.push(...G[c].children); }
  return out;
}

/** Terminal nerves (no children, not a division) reached by the trace, excluding `id` itself. */
export function traceTargets(id: string, G: NerveGraph, trace = computeTrace(id, G)): string[] {
  return [...trace].filter(x => x !== id && G[x].children.length === 0 && G[x].kind !== 'Division');
}

/** Roots the trace passes through. */
export function traceRoots(G: NerveGraph, trace: Set<string>): string[] {
  return [...trace].filter(x => G[x].kind === 'Root');
}
