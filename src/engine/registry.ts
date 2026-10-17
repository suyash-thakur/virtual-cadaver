import type { CatmullRomCurve3, Mesh, Vector3 } from 'three';
import type { Family, Info, Layer, Root } from '../content';
import type { Cov } from './geometry/body';
import type { DeltoidGeo, SheetGeo } from './geometry/builders';
import type { Mat, PeelUniforms } from './materials';

export interface TubeDef { pts: Vector3[]; r: number; caps: boolean; open?: boolean; hit?: boolean; nerve?: boolean; rough: number; freq: number }

/** Runtime record for one structure: content fields plus meshes, materials and animation state. */
export interface RT {
  id: string; name: string; label?: string; kind: string; layer: Layer;
  info?: Info; key?: boolean; landmark?: boolean; lm?: boolean; noCover?: boolean;
  fam?: Family; roots?: Root[]; parents: string[]; children: string[];
  op: number; color: string; cad?: string;
  mat: Mat; meshes: Mesh[]; hits: Mesh[]; cov: Cov[];
  /** Current and target visibility, 0..1. */
  cur: number; target: number; eBase: number;
  /** Dissection removal, 0..1: a detached muscle fades out and lifts away instead of folding. */
  lift: number;
  liftDir?: Vector3;
  anchor: Vector3; curve?: CatmullRomCurve3;
  lbl: HTMLButtonElement; lw?: number;
  fold?: number; foldCur: number; foldSign?: number; sg?: SheetGeo; dg?: DeltoidGeo;
  shellKey?: 'skin' | 'fat' | 'fascia'; peel?: PeelUniforms;
  lines?: Vector3[][]; guides?: Mesh[]; isNerveLike?: boolean;
  /** Tube definitions the meshes were built from, kept so the tubes can be rebuilt after conforming to the skin. */
  tubeDefs?: TubeDef[];
  /** True when every mesh of the structure comes from tubeDefs. */
  tubeOnly?: boolean;
  /** Curve parameter of the label anchor. */
  anchorU?: number;
  /** True when the mesh came from a real asset rather than the procedural builder. */
  real?: boolean;
  /** Fold rig for real meshes: rotate about `pivot` around `axis`, weighted by distance along `dir`. */
  rig?: { base: Float32Array; pivot: Vector3; axis: Vector3; dir: Vector3; span: number };
  /** Free dissection: the origin has been cut with the scalpel, so forceps can reflect it. */
  cutOrigin?: boolean;
  /** True for the surface helpers (skin layers, superficial veins, landmarks) that are not in structures.json. */
  surface?: boolean;
}

export class Registry {
  S: Record<string, RT> = {};
  order: RT[] = [];
  has(id: string) { return id in this.S; }
  get(id: string): RT { const d = this.S[id]; if (!d) throw new Error(`unknown structure ${id}`); return d; }
  add(d: RT) { if (this.S[d.id]) throw new Error(`duplicate ${d.id}`); this.S[d.id] = d; this.order.push(d); }
  nerves() { return this.order.filter(d => d.layer === 'nerves'); }
}
