import { BufferGeometry, Mesh } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

/**
 * Bounding-volume hierarchies for raycasting. Without them every pick and every label
 * occlusion test walks all 350k triangles of the specimen; with them a ray costs microseconds.
 */
type G = BufferGeometry & { computeBoundsTree?: typeof computeBoundsTree; disposeBoundsTree?: typeof disposeBoundsTree; boundsTree?: unknown };
(BufferGeometry.prototype as G).computeBoundsTree = computeBoundsTree;
(BufferGeometry.prototype as G).disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

/** Builds the tree once per geometry. Small geometries and partially drawn ones are left alone. */
export function ensureBVH(geo: BufferGeometry, minTriangles = 400): void {
  const g = geo as G;
  if (g.boundsTree) return;
  const tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  if (tris < minTriangles) return;
  if (geo.drawRange.count !== Infinity) return;
  g.computeBoundsTree!({ targetLeafSize: 8 } as never);
}
