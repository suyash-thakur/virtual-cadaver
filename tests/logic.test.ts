import { describe, it, expect } from 'vitest';
import { loadContent } from '../src/content';
import type { NerveNode } from '../src/content';
import { computeTrace, traceTargets, traceRoots } from '../src/logic/trace';
import { computeLesion } from '../src/logic/lesion';
import { endState, stepState, initialState, blendState } from '../src/logic/dissect';
import { buildSession, grade, updateBox, summarise, mulberry32, makeQuestion } from '../src/logic/spotter';

const C = loadContent();
const G: Record<string, NerveNode> = {};
C.nerves.forEach(n => { G[n.id] = n; });
const inputs = { G, nerves: C.nerves, muscles: C.muscles, sensory: C.sensory };
const lesion = (id: string) => C.lesions.find(l => l.id === id)!;

describe('trace', () => {
  it('C6 reaches the musculocutaneous, axillary, radial and median nerves but not the ulnar', () => {
    const t = computeTrace('c6', G);
    for (const id of ['upperTrunk', 'latCord', 'postCord', 'musculocut', 'axillary', 'radial', 'median', 'suprascap', 'longThoracic']) expect(t.has(id)).toBe(true);
    for (const id of ['ulnar', 'medCord', 'lowerTrunk', 'c8', 't1', 'mcnArm']) expect(t.has(id)).toBe(false);
  });
  it('tracing the ulnar nerve back finds only C8 and T1', () => {
    const t = computeTrace('ulnar', G);
    expect(traceRoots(G, t).sort()).toEqual(['c8', 't1']);
    expect(t.has('medCord')).toBe(true); expect(t.has('latCord')).toBe(false);
  });
  it('targets exclude divisions and the start nerve', () => {
    const tg = traceTargets('c5', G);
    expect(tg).not.toContain('c5'); expect(tg.some(id => G[id].kind === 'Division')).toBe(false);
    expect(tg).toContain('dorsalScap');
  });
});

describe('lesion', () => {
  it("Erb's palsy paralyses deltoid, biceps and supraspinatus, spares serratus anterior and the hand", () => {
    const r = computeLesion(lesion('erb'), inputs);
    const para = r.para.map(m => m.n);
    expect(para).toContain('Deltoid'); expect(para).toContain('Biceps brachii'); expect(para).toContain('Supraspinatus');
    expect(para).not.toContain('Serratus anterior'); expect(para).not.toContain('Interossei');
    expect(r.status.axillary).toBe('lost'); expect(r.status.musculocut).toBe('partial'); expect(r.status.suprascap).toBe('lost');
    expect(r.status.median).toBe('partial'); expect(r.status.radial).toBe('partial');
    expect(r.status.ulnar).toBeUndefined();
    expect(r.mapMode).toBe('dermatomes'); expect(r.regions.dC5).toBe('lost'); expect(r.regions.dC6).toBe('lost'); expect(r.regions.dC8).toBeUndefined();
    expect(r.reflexes.join(' ')).toMatch(/Biceps jerk .* lost/);
  });
  it("Klumpke's palsy paralyses the small muscles of the hand and spares deltoid", () => {
    const r = computeLesion(lesion('klumpke'), inputs);
    const para = r.para.map(m => m.n);
    expect(para).toContain('Interossei'); expect(para).toContain('Thenar muscles'); expect(para).not.toContain('Deltoid');
    expect(r.status.ulnar).toBe('lost'); expect(r.status.musculocut).toBeUndefined();
  });
  it('radial nerve in the spiral groove spares triceps and gives wrist drop', () => {
    const r = computeLesion(lesion('radialgroove'), inputs);
    const para = r.para.map(m => m.n);
    expect(para).not.toContain('Triceps brachii'); expect(para).toContain('Extensors of the wrist, fingers and thumb');
    expect(r.mapMode).toBe('nerves'); expect(r.regions.rPostArm).toBeUndefined(); expect(r.regions.rDorsum).toBe('lost');
  });
  it('median nerve at the wrist spares the palm and the forearm flexors', () => {
    const r = computeLesion(lesion('medianwrist'), inputs);
    expect(r.para.map(m => m.n)).toEqual(expect.arrayContaining(['Thenar muscles', 'Lateral two lumbricals']));
    expect(r.para.map(m => m.n)).not.toContain('Pronator teres');
    expect(r.regions.mPalm).toBeUndefined(); expect(r.regions.mDigits).toBe('lost');
  });
  it('a complete plexus injury paralyses every listed muscle', () => {
    const r = computeLesion(lesion('complete'), inputs);
    expect(r.para.length).toBe(C.muscles.length); expect(r.weak.length).toBe(0);
  });
});

describe('dissection state', () => {
  it('accumulates hides and peels across steps', () => {
    expect(initialState().skin).toEqual([0, 0]);
    const s4 = endState(C.steps, 4);
    expect(s4.skin).toEqual([0.62, 0.58]); expect(s4.fascia).toEqual([0.62, 0.58]); expect(s4.hide).toContain('platysma');
    const s11 = endState(C.steps, 11);
    expect(s11.hide).toEqual(expect.arrayContaining(['clavicle', 'axillaryA', 'axSheath']));
    const s12 = endState(C.steps, 12);
    expect(s12.hide).not.toContain('postCircHumeral'); expect(s12.fold.deltoid).toBe(1); expect(s12.skin[1]).toBeCloseTo(1.02);
  });
  it('an undone step shows the previous state without emphasis', () => {
    const s = stepState(C.steps, 9, false);
    expect(s.hide).not.toContain('axSheath'); expect(s.emph).toEqual([]);
    expect(stepState(C.steps, 9, true).emph).toEqual(C.mNerveIds);
  });
  it('blends between states', () => {
    const b = blendState(endState(C.steps, 1), endState(C.steps, 2), 0.5);
    expect(b.skin[0]).toBeCloseTo(0.31);
  });
});

describe('spotter', () => {
  const pool = C.structures.filter(s => s.layer === 'nerves' || s.layer === 'bones');
  it('builds a reproducible session with four distinct options and the right answer', () => {
    const a = buildSession(pool, C.byId, {}, { n: 8, seed: 42, now: 0 });
    const b = buildSession(pool, C.byId, {}, { n: 8, seed: 42, now: 0 });
    expect(a).toEqual(b); expect(a.length).toBe(8);
    expect(new Set(a.map(q => q.targetId)).size).toBe(8);
    for (const q of a) {
      expect(q.options.length).toBe(4); expect(new Set(q.options).size).toBe(4);
      expect(q.answer).toBeGreaterThanOrEqual(0); expect(grade(q, q.answer)).toBe(true); expect(grade(q, (q.answer + 1) % 4)).toBe(false);
    }
  });
  it('root value questions carry the correct answer', () => {
    const rng = mulberry32(7);
    const q = makeQuestion(C.byId.ulnar, pool, C.byId, rng, ['roots']);
    expect(q.kind).toBe('roots'); expect(q.options[q.answer]).toBe('C8, T1');
  });
  it('spaced repetition asks missed items first and promotes correct ones', () => {
    let box = updateBox({}, 'median', false, 1000);
    expect(box.median.box).toBe(0); expect(box.median.due).toBe(1000);
    box = updateBox(box, 'median', true, 2000);
    expect(box.median.box).toBe(1); expect(box.median.due).toBe(2000 + 86_400_000);
    const s = buildSession(pool, C.byId, { ...box, ulnar: { box: 0, due: 0 } }, { n: 1, seed: 1, now: 5000 });
    expect(s[0].targetId).toBe('ulnar');
  });
  it('summarises attempts', () => {
    const sum = summarise([{ targetId: 'a', kind: 'identify', correct: true, at: 0 }, { targetId: 'b', kind: 'identify', correct: false, at: 0 }]);
    expect(sum.percent).toBe(50); expect(sum.missed).toEqual(['b']);
  });
});
