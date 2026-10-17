import { describe, it, expect } from 'vitest';
import { loadContent } from '../src/content';

describe('content', () => {
  const C = loadContent();
  it('validates and links the nerve graph', () => {
    expect(C.structures.length).toBeGreaterThan(70);
    expect(C.nerves.length).toBe(35);
    const ut = C.byId.upperTrunk; if (ut.layer !== 'nerves') throw new Error();
    expect(ut.children.sort()).toEqual(['divAU', 'divPU', 'nSubclavius', 'suprascap'].sort());
  });
  it('has exactly five roots and three cords', () => {
    expect(C.nerves.filter(n => n.kind === 'Root').map(n => n.id)).toEqual(['c5', 'c6', 'c7', 'c8', 't1']);
    expect(C.nerves.filter(n => n.kind === 'Cord').length).toBe(3);
  });
  it('every step references a view and real structures', () => {
    expect(C.steps.length).toBe(13);
    for (const s of C.steps) { expect(C.views[s.view]).toBeTruthy(); expect(s.find.length).toBeGreaterThan(0); }
  });
  it('terminal branch root values match textbook values', () => {
    const roots = (id: string) => { const n = C.byId[id]; return n.layer === 'nerves' ? n.roots : []; };
    expect(roots('median')).toEqual(['C5', 'C6', 'C7', 'C8', 'T1']);
    expect(roots('ulnar')).toEqual(['C8', 'T1']);
    expect(roots('axillary')).toEqual(['C5', 'C6']);
    expect(roots('musculocut')).toEqual(['C5', 'C6', 'C7']);
    expect(roots('radial')).toEqual(['C5', 'C6', 'C7', 'C8', 'T1']);
  });
});
