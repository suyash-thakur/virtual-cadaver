import { DirectionalLight, HemisphereLight, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, WebGLRenderer, ACESFilmicToneMapping, PCFSoftShadowMap } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface Gfx { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera }

/** Creates the renderer, or returns null when WebGL is unavailable so the app can fall back to the 2D lesson. */
export function createGfx(canvas: HTMLCanvasElement): Gfx | null {
  let renderer: WebGLRenderer;
  try {
    const probe = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!probe) return null;
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { console.error('WebGL unavailable', e); return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1, 0.5, 1200);
  // Physically based light units (three r155+): legacy intensities are scaled by pi.
  // Image-based lighting from a neutral room gives soft fill and believable speculars on wet fascia and vessels.
  const pmrem = new PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.4; pmrem.dispose();
  scene.add(new HemisphereLight(0xf2f7f5, 0x34443f, 0.45 * Math.PI));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap;
  const key = new DirectionalLight(0xfff1dc, 0.85 * Math.PI); key.position.set(-25, 35, 40); scene.add(key);
  // Soft shadows give the layers depth; the shadow camera covers the specimen box.
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0008; key.shadow.normalBias = 0.05; key.shadow.radius = 3;
  const sc = key.shadow.camera; sc.left = -50; sc.right = 50; sc.top = 50; sc.bottom = -50; sc.near = 5; sc.far = 160;
  key.target.position.set(-12, -8, 0); scene.add(key.target);
  const fill = new DirectionalLight(0xe8f0ff, 0.25 * Math.PI); fill.position.set(30, 5, 20); scene.add(fill);
  const rim = new DirectionalLight(0xcfe0ff, 0.4 * Math.PI); rim.position.set(15, -10, -35); scene.add(rim);
  return { renderer, scene, camera };
}
