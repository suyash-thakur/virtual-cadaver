/**
 * Student progress record. Local-first: stored in localStorage, exportable as JSON so a
 * teacher can collect files from a class. The shape is what a backend would store later.
 */
import type { Summary } from './spotter';

export interface SpotterRecord { at: number; total: number; correct: number; missed: string[] }
export interface Progress {
  version: 1;
  student: { name: string; id: string };
  steps: Record<string, { completedAt: number; count: number }>;
  spotter: SpotterRecord[];
  lesions: Record<string, number>;
  updatedAt: number;
}

export const PROGRESS_KEY = 'vc.progress.v1';

export function emptyProgress(name = ''): Progress {
  return { version: 1, student: { name, id: Math.random().toString(36).slice(2, 10) }, steps: {}, spotter: [], lesions: {}, updatedAt: Date.now() };
}

export function recordStep(p: Progress, key: string, now = Date.now()): Progress {
  const prev = p.steps[key];
  return { ...p, steps: { ...p.steps, [key]: { completedAt: now, count: (prev?.count ?? 0) + 1 } }, updatedAt: now };
}
export function recordSpotter(p: Progress, s: Summary, now = Date.now()): Progress {
  return { ...p, spotter: [...p.spotter, { at: now, total: s.total, correct: s.correct, missed: s.missed }], updatedAt: now };
}
export function recordLesion(p: Progress, id: string, now = Date.now()): Progress {
  return { ...p, lesions: { ...p.lesions, [id]: (p.lesions[id] ?? 0) + 1 }, updatedAt: now };
}

export interface Stats { stepsDone: number; spotterSessions: number; spotterAccuracy: number | null; weakest: { id: string; misses: number }[] }
export function stats(p: Progress, totalSteps: number): Stats & { totalSteps: number } {
  const total = p.spotter.reduce((a, s) => a + s.total, 0), correct = p.spotter.reduce((a, s) => a + s.correct, 0);
  const misses: Record<string, number> = {};
  for (const s of p.spotter) for (const id of s.missed) misses[id] = (misses[id] ?? 0) + 1;
  const weakest = Object.entries(misses).map(([id, m]) => ({ id, misses: m })).sort((a, b) => b.misses - a.misses).slice(0, 8);
  return { stepsDone: Object.keys(p.steps).length, totalSteps, spotterSessions: p.spotter.length, spotterAccuracy: total ? Math.round(100 * correct / total) : null, weakest };
}

export function parseProgress(text: string): Progress {
  const p = JSON.parse(text);
  if (!p || p.version !== 1 || typeof p.student !== 'object' || typeof p.steps !== 'object' || !Array.isArray(p.spotter)) throw new Error('not a progress file');
  return p as Progress;
}

/** Class view: one row per student plus the structures most often missed across the class. */
export function classSummary(records: Progress[], totalSteps: number) {
  const rows = records.map(p => ({ name: p.student.name || p.student.id, ...stats(p, totalSteps), updatedAt: p.updatedAt }));
  const misses: Record<string, number> = {};
  for (const p of records) for (const s of p.spotter) for (const id of s.missed) misses[id] = (misses[id] ?? 0) + 1;
  const classWeakest = Object.entries(misses).map(([id, m]) => ({ id, misses: m })).sort((a, b) => b.misses - a.misses).slice(0, 12);
  const acc = rows.filter(r => r.spotterAccuracy != null).map(r => r.spotterAccuracy!);
  return { rows, classWeakest, meanAccuracy: acc.length ? Math.round(acc.reduce((a, b) => a + b, 0) / acc.length) : null, meanSteps: rows.length ? Math.round(rows.reduce((a, r) => a + r.stepsDone, 0) / rows.length * 10) / 10 : 0 };
}
