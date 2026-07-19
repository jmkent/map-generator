// Regular-grid terrain mesher. PURE.

import type { TerrainModel } from "../../gen/types";
import { gridPoint } from "../../gen/stages/terrain";
import type { GeometryData } from "../geometryData";

/** Convert analytical terrain samples to a visibly raised local landscape. */
export function terrainGeometry(terrain: TerrainModel, verticalScale = 0.002): GeometryData {
    const { resolution, samples, bounds } = terrain;
    const positions = new Float32Array(resolution * resolution * 3);
    const normals = new Float32Array(resolution * resolution * 3);
    const indices = new Uint32Array((resolution - 1) * (resolution - 1) * 6);
    for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
            const index = y * resolution + x;
            const offset = index * 3;
            // (grid x,y) -> world (x, z); height lifts the y axis.
            const world = gridPoint(bounds, resolution, x, y);
            positions[offset] = world.x;
            positions[offset + 1] = samples[index].height * verticalScale;
            positions[offset + 2] = world.y;
            normals[offset + 1] = 1;
        }
    }
    let cursor = 0;
    for (let y = 0; y < resolution - 1; y++) {
        for (let x = 0; x < resolution - 1; x++) {
            const a = y * resolution + x;
            const b = a + 1;
            const c = a + resolution;
            const d = c + 1;
            indices[cursor++] = a;
            indices[cursor++] = d;
            indices[cursor++] = b;
            indices[cursor++] = a;
            indices[cursor++] = c;
            indices[cursor++] = d;
        }
    }
    return { positions, normals, indices };
}
