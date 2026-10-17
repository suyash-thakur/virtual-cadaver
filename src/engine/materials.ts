import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, MeshStandardMaterial, Vector2, Vector3, type Texture } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { ATLAS_W, DEPTH_TOL, FACE } from './cutmask';

export type Mat = MeshPhysicalMaterial | MeshStandardMaterial;

export function makeMat(color: string, op: number, double: boolean): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({ color, roughness: .5, metalness: 0, transparent: op < 1, opacity: op, side: double ? DoubleSide : FrontSide });
}

export interface PeelUniforms {
  uCutT: { value: number }; uCutA: { value: number }; uInner: { value: Color };
  uMask: { value: Texture | null }; uMaskOn: { value: number }; uMaskMin: { value: Vector3 }; uMaskSize: { value: Vector3 }; uMaskTex: { value: Vector2 };
}

/**
 * Skin, fat and fascia shells. Each vertex carries a `peel` order and a `warm` weight
 * (trunk vs arm) for the guided dissection; fragments past the cut are discarded and the
 * edge curls outward. Free dissection reads the shell's cut mask atlas (see cutmask.ts):
 * removed texels are discarded with a darkened rim, incision lines render as a groove.
 */
export interface ShellTex { map?: Texture; bumpMap?: Texture; bumpScale?: number; roughness?: number }
export function peelMaterial(color: string, rough: number, op: number, inner: string, tex?: ShellTex): { mat: MeshStandardMaterial; u: PeelUniforms } {
  const m = new MeshStandardMaterial({ color, roughness: tex?.roughness ?? rough, metalness: 0, vertexColors: true, side: DoubleSide, transparent: op < 1, opacity: op, map: tex?.map ?? null, bumpMap: tex?.bumpMap ?? null, bumpScale: tex?.bumpScale ?? 1 });
  const u: PeelUniforms = { uCutT: { value: 0 }, uCutA: { value: 0 }, uInner: { value: new Color(inner) },
    uMask: { value: null }, uMaskOn: { value: 0 }, uMaskMin: { value: new Vector3() }, uMaskSize: { value: new Vector3(1, 1, 1) }, uMaskTex: { value: new Vector2(ATLAS_W, FACE) } };
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float peel;\nattribute float warm;\nuniform float uCutT;\nuniform float uCutA;\nvarying float vPeel;\nvarying float vCut;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vPeel = peel; vCut = mix(uCutT, uCutA, warm);
        float dd = peel - vCut;
        if (vCut > 0.001 && dd > 0.0) { transformed += normalize(objectNormal) * 0.45 * (1.0 - smoothstep(0.0, 0.12, dd)); }
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = `uniform vec3 uInner; uniform sampler2D uMask; uniform float uMaskOn; uniform vec3 uMaskMin; uniform vec3 uMaskSize; uniform vec2 uMaskTex;
varying float vPeel; varying float vCut; varying vec3 vWPos; varying vec3 vWNrm;
float cutRim = 0.0; float cutGroove = 0.0;
` +
      sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vPeel < vCut) discard;
        if (uMaskOn > 0.5) {
          vec3 an = abs(vWNrm); vec3 q = (vWPos - uMaskMin) / uMaskSize;
          float face; vec2 fuv; float d;
          if (an.z >= 0.35) { face = 2.0; fuv = q.xy; d = q.z; } else if (an.x >= an.y) { face = 0.0; fuv = q.yz; d = q.x; } else { face = 1.0; fuv = q.xz; d = q.y; }
          float F = uMaskTex.y;
          vec2 st = vec2(face * F + clamp(fuv.x, 0.0, 1.0) * (F - 1.0) + 0.5, clamp(fuv.y, 0.0, 1.0) * (F - 1.0) + 0.5);
          ivec2 b = ivec2(floor(st - 0.5)); float ok = 0.0;
          for (int oy = 0; oy < 2; oy++) for (int ox = 0; ox < 2; ox++) {
            ivec2 tc = clamp(b + ivec2(ox, oy), ivec2(int(face * F), 0), ivec2(int(face * F) + int(F) - 1, int(F) - 1));
            vec4 t = texelFetch(uMask, tc, 0);
            if ((t.r > 0.2 || t.g > 0.2) && abs(t.b - d) < ${DEPTH_TOL.toFixed(3)}) ok = 1.0;
          }
          vec4 mk = texture2D(uMask, st / uMaskTex) * ok;
          if (mk.r > 0.5) discard;
          cutRim = smoothstep(0.06, 0.5, mk.r); cutGroove = smoothstep(0.15, 0.6, mk.g);
        }`).replace('#include <color_fragment>', `#include <color_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb *= uInner;
        diffuseColor.rgb *= 1.0 - 0.72 * cutRim;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.05, 0.05), cutGroove);`);
  };
  m.customProgramCacheKey = () => 'peel2';
  return { mat: m, u };
}
