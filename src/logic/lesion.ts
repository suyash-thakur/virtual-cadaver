import type { Lesion, Muscle, NerveNode, Root } from '../content';
import type { NerveGraph } from './trace';

export type NerveStatus = 'lost' | 'partial';
export type MuscleStatus = 'paralysed' | 'weak';
export type RegionStatus = 'lost' | 'reduced';

export interface LesionResult {
  atIds: string[];
  /** Root values whose fibres are interrupted, per nerve downstream of the cut. */
  lost: Record<string, Set<Root>>;
  status: Record<string, NerveStatus>;
  para: Muscle[];
  weak: Muscle[];
  /** Status of 3D muscle meshes, keyed by structure id. */
  m3d: Record<string, MuscleStatus>;
  regions: Record<string, RegionStatus>;
  mapMode: 'dermatomes' | 'nerves';
  reflexes: string[];
}

export interface LesionInputs {
  G: NerveGraph;
  nerves: NerveNode[];
  muscles: Muscle[];
  sensory: Record<string, string[][]>;
}

/**
 * Propagates a cut downstream through the plexus graph by root value, then derives
 * paralysed and weakened muscles, lost reflexes and the areas of skin affected.
 * Pure: safe to call from tests and from the UI.
 */
export function computeLesion(L: Lesion, inp: LesionInputs): LesionResult {
  const { G, nerves, muscles, sensory } = inp;
  const atIds = L.at.map(a => a[0]);
  const lost: Record<string, Set<Root>> = {};
  atIds.forEach(id => { lost[id] = new Set(G[id].roots); });
  let changed = true, guard = 0;
  while (changed && guard++ < 20) {
    changed = false;
    for (const n of nerves) {
      if (atIds.includes(n.id)) continue;
      const fromP = new Set<Root>();
      n.parents.forEach(p => { lost[p]?.forEach(r => fromP.add(r)); });
      const lr = n.roots.filter(r => fromP.has(r));
      if (lr.length && (!lost[n.id] || lost[n.id].size !== lr.length)) { lost[n.id] = new Set(lr); changed = true; }
    }
  }
  const status: Record<string, NerveStatus> = {};
  Object.keys(lost).forEach(id => { status[id] = lost[id].size === G[id].roots.length ? 'lost' : 'partial'; });

  const spare = L.spare || [];
  const para: Muscle[] = [], weak: Muscle[] = [];
  const m3d: Record<string, MuscleStatus> = {};
  for (const mu of muscles) {
    let lostN = 0, part = false;
    for (const id of mu.nv) {
      const lr = lost[id]; if (!lr) continue;
      if (atIds.includes(id) && mu.lv && spare.includes(mu.lv)) continue;
      // Only the root values this nerve actually carries to the muscle count toward its supply.
      const viaNerve = mu.r.filter(r => G[id].roots.includes(r));
      const rel = viaNerve.length ? viaNerve : mu.r;
      if (rel.every(r => lr.has(r))) lostN++; else if (rel.some(r => lr.has(r))) part = true;
    }
    const st: MuscleStatus | null = lostN === mu.nv.length ? 'paralysed' : (lostN > 0 || part ? 'weak' : null);
    if (st === 'paralysed') para.push(mu); else if (st === 'weak') weak.push(mu);
    if (st && mu.m) m3d[mu.m] = (m3d[mu.m] === 'paralysed' || st === 'paralysed') ? 'paralysed' : 'weak';
  }

  const regions: Record<string, RegionStatus> = {};
  let mapMode: LesionResult['mapMode'] = 'nerves';
  if (atIds.some(id => G[id].kind === 'Root' || G[id].kind === 'Trunk')) {
    mapMode = 'dermatomes';
    const Rs = new Set<Root>(); atIds.forEach(id => lost[id].forEach(r => Rs.add(r)));
    Rs.forEach(r => { regions['d' + r] = 'lost'; });
  } else {
    for (const nid of Object.keys(sensory)) {
      const lr = lost[nid]; if (!lr) continue;
      const full = lr.size === G[nid].roots.length;
      for (const [reg, lv] of sensory[nid]) {
        if (atIds.includes(nid) && lv && spare.includes(lv)) continue;
        regions[reg] = full ? 'lost' : (regions[reg] === 'lost' ? 'lost' : 'reduced');
      }
    }
  }
  const reflexes = para.filter(m => m.reflex).map(m => m.reflex + ' lost').concat(weak.filter(m => m.reflex).map(m => m.reflex + ' reduced'));
  return { atIds, lost, status, para, weak, m3d, regions, mapMode, reflexes };
}

/** A lesion placed by tapping a nerve at parameter `u` along its curve. */
export function customLesion(nerveId: string, name: string, u: number): Lesion {
  return { id: 'custom', custom: true, group: 'Custom', name: `${name} cut here`, site: 'A cut at the point you tapped', at: [[nerveId, Math.max(0, Math.min(1, u))]] };
}
