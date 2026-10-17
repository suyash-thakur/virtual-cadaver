import { z } from 'zod';

/** World-space point [x, y, z]. x is already mirrored so the right limb reads on the viewer's left. */
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;
/** Authoring-space point [lateral, superior, anterior]; the engine mirrors x when it builds geometry. */
export const AuthVec3 = Vec3;

export const Info = z.object({
  lies: z.string().optional(),
  supplies: z.string().optional(),
  skin: z.string().optional(),
  clinical: z.string().optional(),
});
export type Info = z.infer<typeof Info>;

export const Root = z.enum(['C5', 'C6', 'C7', 'C8', 'T1']);
export type Root = z.infer<typeof Root>;
export const Family = z.enum(['rt', 'rtc', 'lat', 'med', 'post', 'median']);
export type Family = z.infer<typeof Family>;
export const Layer = z.enum(['nerves', 'bones', 'supmus', 'deepmus', 'vessels', 'skin']);
export type Layer = z.infer<typeof Layer>;

export const Nerve = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string().optional(),
  kind: z.string(),
  layer: z.literal('nerves'),
  fam: Family,
  roots: z.array(Root).min(1),
  parents: z.array(z.string()),
  r: z.number().positive(),
  key: z.boolean().optional(),
  lu: z.number().min(0).max(1).optional(),
  paths: z.array(z.array(Vec3).min(2)).min(1),
  info: Info.optional(),
});
export type Nerve = z.infer<typeof Nerve>;

export const Tube = z.object({ pts: z.array(Vec3).min(2), r: z.number().positive(), caps: z.boolean().optional(), open: z.boolean().optional() });
export const Sheet = z.object({ o: z.array(Vec3).min(2), i: z.array(Vec3).min(2), bulge: z.number(), bdir: AuthVec3.optional() });
export const Plate = z.object({ c: AuthVec3, ring: z.array(AuthVec3).min(3), shrink: z.number(), dz: z.number() });

export const Other = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string().optional(),
  kind: z.string(),
  layer: Layer.exclude(['nerves']),
  color: z.string(),
  cad: z.string().optional(),
  op: z.number().min(0).max(1),
  landmark: z.boolean().optional(),
  noCover: z.boolean().optional(),
  fold: z.number().optional(),
  custom: z.enum(['deltoid', 'fatpad']).optional(),
  anchor: Vec3,
  tubes: z.array(Tube).optional(),
  spheres: z.array(z.object({ c: Vec3, r: z.number().positive() })).optional(),
  boxes: z.array(z.object({ c: Vec3, s: Vec3 })).optional(),
  cyls: z.array(z.object({ c: Vec3, r: z.number().positive(), h: z.number().positive() })).optional(),
  sheet: Sheet.optional(),
  plate: Plate.optional(),
  info: Info.optional(),
});
export type Other = z.infer<typeof Other>;

export const Structure = z.discriminatedUnion('layer', [Nerve, Other.extend({ layer: Layer.exclude(['nerves']) })]);
export type Structure = z.infer<typeof Structure>;

export const StructuresFile = z.object({ version: z.number(), region: z.string(), structures: z.array(Structure).min(1) });

export const SurfaceInfo = z.object({ name: z.string(), kind: z.string(), info: Info });
export type SurfaceInfo = z.infer<typeof SurfaceInfo>;
export const Shell = z.object({
  id: z.string(), key: z.enum(['skin', 'fat', 'fascia']), iso: z.number(), color: z.string(), cad: z.string(), inner: z.string(),
  rough: z.number(), op: z.number(), tone: Vec3,
});
export type Shell = z.infer<typeof Shell>;
export const SurfaceFile = z.object({ version: z.number(), surfaces: z.record(z.string(), SurfaceInfo), shells: z.array(Shell).length(3) });

export const Step = z.object({
  key: z.string(),
  title: z.string(),
  view: z.string(),
  text: z.string(),
  find: z.array(z.string()),
  act: z.string().optional(),
  hand: z.string().optional(),
  set: z.object({
    inc: z.number().optional(),
    skin: z.tuple([z.number(), z.number()]).optional(),
    fat: z.tuple([z.number(), z.number()]).optional(),
    fascia: z.tuple([z.number(), z.number()]).optional(),
    fold: z.record(z.string(), z.number()).optional(),
  }).optional(),
  hide: z.array(z.string()).optional(),
  show: z.array(z.string()).optional(),
  dim: z.array(z.string()).optional(),
  emph: z.array(z.string()).optional(),
  /** NMC CBME competency codes this step addresses (filled in by faculty). */
  competencies: z.array(z.string()).optional(),
});
export type Step = z.infer<typeof Step>;
export const StepsFile = z.object({ version: z.number(), steps: z.array(Step).min(1), incisionNames: z.array(z.string()), vesselIds: z.array(z.string()), mNerveIds: z.array(z.string()) });

export const View = z.object({ c: AuthVec3, d: AuthVec3, w: z.number().positive(), h: z.number().positive() });
export type View = z.infer<typeof View>;
export const ViewsFile = z.object({ version: z.number(), views: z.record(z.string(), View) });

export const PaletteFile = z.object({
  version: z.number(),
  families: z.record(Family, z.object({ c: z.string(), name: z.string() })),
  classicNerve: z.string(), cadaverNerve: z.string(), roots: z.array(Root).length(5),
  bone: z.string(), boneCadaver: z.string(), muscleCadaver: z.string(), artery: z.string(), arteryCadaver: z.string(),
  vein: z.string(), veinCadaver: z.string(), fascia: z.string(),
});

export type PaletteFile = z.infer<typeof PaletteFile>;

export const Muscle = z.object({
  n: z.string(), nv: z.array(z.string()).min(1), r: z.array(Root).min(1), a: z.string(),
  m: z.string().optional(), lv: z.string().optional(), reflex: z.string().optional(),
});
export type Muscle = z.infer<typeof Muscle>;
export const SensoryEntry = z.tuple([z.string(), z.string().optional()]).or(z.tuple([z.string()]));
export const MusclesFile = z.object({ version: z.number(), muscles: z.array(Muscle), sensory: z.record(z.string(), z.array(z.array(z.string()).min(1).max(2))) });

export const Lesion = z.object({
  id: z.string(), group: z.string(), name: z.string(), site: z.string(),
  at: z.array(z.tuple([z.string(), z.number().min(0).max(1)])).min(1),
  cause: z.string().optional(), sees: z.string().optional(), moves: z.string().optional(),
  reflex: z.string().optional(), signs: z.string().optional(), spare: z.array(z.string()).optional(),
  custom: z.boolean().optional(),
});
export type Lesion = z.infer<typeof Lesion>;
export const LesionsFile = z.object({ version: z.number(), rootIds: z.array(z.string()).length(5), lesions: z.array(Lesion) });

export const SkinMapFile = z.object({ version: z.number(), limb: z.string(), regions: z.record(z.string(), z.tuple([z.string(), z.string()])) });

export const PhotosFile = z.object({
  version: z.number(),
  photos: z.record(z.string(), z.object({ src: z.string(), caption: z.string().optional(), credit: z.string().optional(), kind: z.enum(['photo', 'illustration']).optional() })),
});
export type PhotosFile = z.infer<typeof PhotosFile>;
