import type { Step } from '../content';

/** Peel values are [trunk, arm]; 0 intact, 1 fully removed. */
export interface DissectState {
  skin: [number, number];
  fat: [number, number];
  fascia: [number, number];
  inc: number;
  fold: Record<string, number>;
  hide: string[];
  dim: string[];
  emph: string[];
}

export const FOLDABLE = ['pecMajor', 'pecMinor', 'deltoid'];

export function initialState(): DissectState {
  const fold: Record<string, number> = {}; FOLDABLE.forEach(k => { fold[k] = 0; });
  return { skin: [0, 0], fat: [0, 0], fascia: [0, 0], inc: 0, fold, hide: [], dim: [], emph: [] };
}

/** Cumulative state after steps 0..n have been completed. */
export function endState(steps: Step[], n: number): DissectState {
  const s = initialState();
  for (let i = 0; i <= Math.min(n, steps.length - 1); i++) {
    const st = steps[i];
    if (st.set) {
      if (st.set.skin) s.skin = [...st.set.skin];
      if (st.set.fat) s.fat = [...st.set.fat];
      if (st.set.fascia) s.fascia = [...st.set.fascia];
      if (st.set.inc != null) s.inc = st.set.inc;
      if (st.set.fold) Object.assign(s.fold, st.set.fold);
    }
    if (st.hide) s.hide = s.hide.concat(st.hide);
    if (st.show) s.hide = s.hide.filter(x => !st.show!.includes(x));
    s.dim = st.dim ? st.dim.slice() : [];
    s.emph = st.emph ? st.emph.slice() : [];
  }
  return s;
}

/** State shown for step `n`: the end state if its action is done, otherwise the state before it. */
export function stepState(steps: Step[], n: number, done: boolean): DissectState {
  if (done) return endState(steps, n);
  const s = n > 0 ? endState(steps, n - 1) : initialState();
  s.dim = []; s.emph = [];
  return s;
}

/** Linear blend of the continuous part of two states, used for hands-on progress. */
export function blendState(a: DissectState, b: DissectState, q: number): Pick<DissectState, 'skin' | 'fat' | 'fascia' | 'inc' | 'fold'> {
  const L = (x: number, y: number) => x + (y - x) * q;
  const fold: Record<string, number> = {};
  Object.keys(b.fold).forEach(k => { fold[k] = L(a.fold[k] ?? 0, b.fold[k]); });
  return {
    skin: [L(a.skin[0], b.skin[0]), L(a.skin[1], b.skin[1])],
    fat: [L(a.fat[0], b.fat[0]), L(a.fat[1], b.fat[1])],
    fascia: [L(a.fascia[0], b.fascia[0]), L(a.fascia[1], b.fascia[1])],
    inc: L(a.inc, b.inc), fold,
  };
}

export const isIncisionStep = (st: Step) => !!(st.set && st.set.inc != null);
