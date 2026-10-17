import { describe, it, expect } from 'vitest';
import { emptyProgress, recordStep, recordSpotter, recordLesion, stats, parseProgress, classSummary } from '../src/logic/progress';

describe('progress', () => {
  it('records steps, sessions and lesions immutably', () => {
    const p0 = emptyProgress('Asha');
    const p1 = recordStep(p0, 'skin', 10);
    const p2 = recordStep(p1, 'skin', 20);
    expect(p0.steps.skin).toBeUndefined(); expect(p2.steps.skin).toEqual({ completedAt: 20, count: 2 });
    const p3 = recordSpotter(p2, { total: 10, correct: 7, percent: 70, missed: ['ulnar', 'median', 'ulnar'] }, 30);
    const p4 = recordLesion(p3, 'erb', 40);
    const s = stats(p4, 13);
    expect(s.stepsDone).toBe(1); expect(s.spotterAccuracy).toBe(70); expect(s.weakest[0]).toEqual({ id: 'ulnar', misses: 2 });
    expect(p4.lesions.erb).toBe(1);
  });
  it('round-trips through JSON and rejects junk', () => {
    const p = recordStep(emptyProgress('B'), 'fat');
    expect(parseProgress(JSON.stringify(p))).toEqual(p);
    expect(() => parseProgress('{"version":2}')).toThrow();
    expect(() => parseProgress('[]')).toThrow();
  });
  it('summarises a class', () => {
    const a = recordSpotter(recordStep(emptyProgress('A'), 'skin'), { total: 10, correct: 5, percent: 50, missed: ['radial'] });
    const b = recordSpotter(emptyProgress('B'), { total: 10, correct: 9, percent: 90, missed: ['radial', 'ulnar'] });
    const c = classSummary([a, b], 13);
    expect(c.rows.length).toBe(2); expect(c.meanAccuracy).toBe(70); expect(c.classWeakest[0]).toEqual({ id: 'radial', misses: 2 }); expect(c.meanSteps).toBe(0.5);
  });
});
