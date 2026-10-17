import * as S from './schema';
import structuresJson from './data/structures.json';
import surfaceJson from './data/surface.json';
import stepsJson from './data/steps.json';
import viewsJson from './data/views.json';
import paletteJson from './data/palette.json';
import musclesJson from './data/muscles.json';
import lesionsJson from './data/lesions.json';
import skinmapJson from './data/skinmap.json';
import photosJson from './data/photos.json';

export type { Structure, Nerve, Other, Step, Lesion, Muscle, Root, Family, Layer, Vec3, View, Info } from './schema';

export interface NerveNode extends S.Nerve { children: string[] }

export interface Content {
  region: string;
  structures: S.Structure[];
  /** Lookup by id. Nerves carry a computed `children` list. */
  byId: Record<string, S.Other | NerveNode>;
  nerves: NerveNode[];
  surfaces: Record<string, S.SurfaceInfo>;
  shells: S.Shell[];
  steps: S.Step[];
  incisionNames: string[];
  vesselIds: string[];
  mNerveIds: string[];
  views: Record<string, S.View>;
  palette: S.PaletteFile;
  muscles: S.Muscle[];
  sensory: Record<string, string[][]>;
  rootIds: string[];
  lesions: S.Lesion[];
  skinMap: { limb: string; regions: Record<string, [string, string]> };
  photos: S.PhotosFile['photos'];
}

export type SurfaceInfo = S.SurfaceInfo;
export type Shell = S.Shell;

/** Validates every content file and links the nerve graph. Throws with a readable path on bad content. */
export function loadContent(): Content {
  const structures = S.StructuresFile.parse(structuresJson);
  const surface = S.SurfaceFile.parse(surfaceJson);
  const steps = S.StepsFile.parse(stepsJson);
  const views = S.ViewsFile.parse(viewsJson);
  const palette = S.PaletteFile.parse(paletteJson);
  const muscles = S.MusclesFile.parse(musclesJson);
  const lesions = S.LesionsFile.parse(lesionsJson);
  const skinMap = S.SkinMapFile.parse(skinmapJson);
  const photos = S.PhotosFile.parse(photosJson);

  const byId: Record<string, S.Other | NerveNode> = {};
  const nerves: NerveNode[] = [];
  for (const st of structures.structures) {
    if (byId[st.id]) throw new Error(`duplicate structure id: ${st.id}`);
    if (st.layer === 'nerves') { const n: NerveNode = { ...st, children: [] }; byId[st.id] = n; nerves.push(n); }
    else byId[st.id] = st;
  }
  for (const n of nerves) for (const p of n.parents) {
    const parent = byId[p];
    if (!parent || parent.layer !== 'nerves') throw new Error(`nerve ${n.id} has unknown parent ${p}`);
    (parent as NerveNode).children.push(n.id);
  }
  const known = new Set([...Object.keys(byId), ...Object.keys(surface.surfaces)]);
  steps.steps.forEach((st, i) => {
    if (!views.views[st.view]) throw new Error(`step ${i} (${st.key}) uses unknown view ${st.view}`);
    for (const id of [...st.find, ...(st.hide || []), ...(st.show || []), ...(st.dim || []), ...(st.emph || [])])
      if (!known.has(id)) throw new Error(`step ${st.key} references unknown structure ${id}`);
  });
  for (const L of lesions.lesions) for (const [id] of L.at) if (!byId[id] || byId[id].layer !== 'nerves') throw new Error(`lesion ${L.id} is placed on unknown nerve ${id}`);
  for (const m of muscles.muscles) for (const id of m.nv) if (!byId[id] || byId[id].layer !== 'nerves') throw new Error(`muscle ${m.n} names unknown nerve ${id}`);
  for (const id of Object.keys(muscles.sensory)) if (!byId[id]) throw new Error(`sensory map names unknown nerve ${id}`);
  for (const key of Object.keys(photos.photos)) if (!steps.steps.some(s => s.key === key)) throw new Error(`photo is attached to unknown step ${key}`);

  return {
    region: structures.region, structures: structures.structures, byId, nerves,
    surfaces: surface.surfaces, shells: surface.shells,
    steps: steps.steps, incisionNames: steps.incisionNames, vesselIds: steps.vesselIds, mNerveIds: steps.mNerveIds,
    views: views.views, palette, muscles: muscles.muscles, sensory: muscles.sensory,
    rootIds: lesions.rootIds, lesions: lesions.lesions, skinMap, photos: photos.photos,
  };
}
