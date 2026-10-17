/**
 * Spotter assessment: the pin-and-identify format used in MBBS anatomy practicals.
 * Pure logic. The engine supplies the pool of pinnable structures; this module builds
 * the questions, grades answers and keeps a Leitner box for spaced repetition.
 */
import type { Structure, NerveNode } from '../content';

export type QuestionKind = 'identify' | 'roots' | 'supplies' | 'parent';

export interface Question {
  kind: QuestionKind;
  /** Structure the pin sits on. */
  targetId: string;
  prompt: string;
  options: string[];
  answer: number;
}

export interface Attempt { targetId: string; kind: QuestionKind; correct: boolean; at: number }

export interface LeitnerBox { [targetId: string]: { box: number; due: number } }

export type Rng = () => number;

/** Deterministic PRNG so sessions can be replayed and tests are stable. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const nameOf = (s: Structure) => s.name;
const rootsText = (n: NerveNode) => n.roots.length > 2 ? `${n.roots[0]}–${n.roots[n.roots.length - 1]}` : n.roots.join(', ');

function pickDistractors<T>(pool: T[], exclude: (x: T) => boolean, n: number, rng: Rng): T[] {
  return shuffle(pool.filter(x => !exclude(x)), rng).slice(0, n);
}

/** One question about `target`, with distractors drawn from `pool` (same layer preferred). */
export function makeQuestion(target: Structure, pool: Structure[], byId: Record<string, Structure>, rng: Rng, kinds: QuestionKind[] = ['identify', 'roots', 'supplies', 'parent']): Question {
  const sameLayer = pool.filter(s => s.layer === target.layer && s.id !== target.id);
  const avail: QuestionKind[] = kinds.includes('identify') ? ['identify'] : [];
  if (target.layer === 'nerves') {
    const n = target as NerveNode;
    if (kinds.includes('roots')) avail.push('roots');
    if (kinds.includes('supplies') && n.info?.supplies) avail.push('supplies');
    if (kinds.includes('parent') && n.parents.length === 1) avail.push('parent');
  }
  const kind = avail.length ? avail[Math.floor(rng() * avail.length)] : 'identify';
  let correct: string, pile: string[], prompt: string;
  if (kind === 'roots') {
    const n = target as NerveNode;
    correct = rootsText(n);
    const others = new Set<string>();
    for (const s of shuffle(pool.filter(s => s.layer === 'nerves'), rng)) { const t = rootsText(s as NerveNode); if (t !== correct) others.add(t); if (others.size >= 3) break; }
    pile = [...others];
    prompt = `What are the root values of the pinned structure (${n.name})?`;
  } else if (kind === 'supplies') {
    const n = target as NerveNode;
    correct = n.info!.supplies!;
    pile = pickDistractors(pool.filter(s => s.layer === 'nerves' && s.info?.supplies && s.info.supplies !== correct), () => false, 3, rng).map(s => s.info!.supplies!);
    prompt = `What does the pinned nerve (${n.name}) supply?`;
  } else if (kind === 'parent') {
    const n = target as NerveNode;
    correct = byId[n.parents[0]].name;
    pile = pickDistractors(pool.filter(s => s.layer === 'nerves' && ['Cord', 'Trunk', 'Root', 'Division'].includes(s.kind)), s => s.name === correct, 3, rng).map(nameOf);
    prompt = `The pinned structure (${n.name}) arises from which of these?`;
  } else {
    correct = nameOf(target);
    const src = sameLayer.length >= 3 ? sameLayer : pool.filter(s => s.id !== target.id);
    pile = pickDistractors(src, () => false, 3, rng).map(nameOf);
    prompt = 'Identify the pinned structure.';
  }
  const options = shuffle([correct, ...pile.slice(0, 3)], rng);
  return { kind, targetId: target.id, prompt, options, answer: options.indexOf(correct) };
}

/** Chooses targets, due items first, then unseen, then the rest; never repeats within a session. */
export function chooseTargets(pool: Structure[], box: LeitnerBox, now: number, n: number, rng: Rng): Structure[] {
  const due = pool.filter(s => box[s.id] && box[s.id].due <= now);
  const unseen = pool.filter(s => !box[s.id]);
  const rest = pool.filter(s => box[s.id] && box[s.id].due > now);
  const ordered = [...shuffle(due, rng), ...shuffle(unseen, rng), ...shuffle(rest, rng)];
  return ordered.slice(0, Math.min(n, ordered.length));
}

export function buildSession(pool: Structure[], byId: Record<string, Structure>, box: LeitnerBox, opts: { n?: number; seed?: number; now?: number; kinds?: QuestionKind[] } = {}): Question[] {
  const rng = mulberry32(opts.seed ?? Date.now());
  const targets = chooseTargets(pool, box, opts.now ?? Date.now(), opts.n ?? 10, rng);
  return targets.map(t => makeQuestion(t, pool, byId, rng, opts.kinds));
}

export const grade = (q: Question, choice: number): boolean => choice === q.answer;

const DAY = 86_400_000;
/** Leitner intervals by box: wrong answers fall back to box 0 (ask again today). */
export const INTERVALS = [0, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY];

export function updateBox(box: LeitnerBox, targetId: string, correct: boolean, now: number): LeitnerBox {
  const cur = box[targetId]?.box ?? 0;
  const next = correct ? Math.min(INTERVALS.length - 1, cur + 1) : 0;
  return { ...box, [targetId]: { box: next, due: now + INTERVALS[next] } };
}

export interface Summary { total: number; correct: number; percent: number; missed: string[] }
export function summarise(attempts: Attempt[]): Summary {
  const correct = attempts.filter(a => a.correct).length;
  return { total: attempts.length, correct, percent: attempts.length ? Math.round(100 * correct / attempts.length) : 0, missed: attempts.filter(a => !a.correct).map(a => a.targetId) };
}
