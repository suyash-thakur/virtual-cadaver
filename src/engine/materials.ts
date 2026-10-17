import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';

export type Mat = MeshPhysicalMaterial | MeshStandardMaterial;

export function makeMat(color: string, op: number, double: boolean): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({ color, roughness: .5, metalness: 0, transparent: op < 1, opacity: op, side: double ? DoubleSide : FrontSide });
}

export interface PeelUniforms { uCutT: { value: number }; uCutA: { value: number }; uInner: { value: Color } }

/**
 * Skin, fat and fascia shells. Each vertex carries a `peel` order and a `warm` weight
 * (trunk vs arm); fragments past the cut are discarded and the edge curls outward.
 */
export function peelMaterial(color: string, rough: number, op: number, inner: string): { mat: MeshStandardMaterial; u: PeelUniforms } {
  const m = new MeshStandardMaterial({ color, roughness: rough, metalness: 0, vertexColors: true, side: DoubleSide, transparent: op < 1, opacity: op });
  const u: PeelUniforms = { uCutT: { value: 0 }, uCutA: { value: 0 }, uInner: { value: new Color(inner) } };
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float peel;\nattribute float warm;\nattribute float mask;\nuniform float uCutT;\nuniform float uCutA;\nvarying float vPeel;\nvarying float vCut;\nvarying float vMask;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vPeel = peel; vCut = mix(uCutT, uCutA, warm); vMask = mask;
        float dd = peel - vCut;
        if (vCut > 0.001 && dd > 0.0) { transformed += normalize(objectNormal) * 0.45 * (1.0 - smoothstep(0.0, 0.12, dd)); }`);
    sh.fragmentShader = 'uniform vec3 uInner;\nvarying float vPeel;\nvarying float vCut;\nvarying float vMask;\n' +
      sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vPeel < vCut || vMask > 0.5) discard;`).replace('#include <color_fragment>', `#include <color_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb *= uInner;`);
  };
  m.customProgramCacheKey = () => 'peel';
  return { mat: m, u };
}
