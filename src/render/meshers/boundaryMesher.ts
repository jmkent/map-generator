// Boundary mesher: fan-triangulate the (star-shaped) boundary polygon from its
// centroid into a flat mesh on the y=0 plane. PURE — emits GeometryData; the
// Babylon upload lives in the Renderer. Star-shapedness guarantees the fan is
// valid (every centroid->edge triangle lies inside the polygon).

import type { Polygon } from "../../gen/types";
import { centroid } from "../../gen/geometry/polygon";
import type { GeometryData } from "../geometryData";

export function boundaryGeometry(poly: Polygon, y = 0): GeometryData {
    const n = poly.length;
    const vertexCount = n + 1; // centroid + ring
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);

    const c = centroid(poly);
    positions[0] = c.x;
    positions[1] = y;
    positions[2] = c.y; // generation-y -> world-z
    for (let i = 0; i < n; i++) {
        const o = (i + 1) * 3;
        positions[o] = poly[i].x;
        positions[o + 1] = y;
        positions[o + 2] = poly[i].y;
    }
    for (let i = 0; i < vertexCount; i++) {
        normals[i * 3 + 1] = 1; // all faces point +Y (up)
    }

    const indices = new Uint32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const ring = i + 1;
        const nextRing = ((i + 1) % n) + 1;
        // Wound so the front face points +Y in lite's left-handed space.
        indices[i * 3] = 0;
        indices[i * 3 + 1] = ring;
        indices[i * 3 + 2] = nextRing;
    }
    return { positions, normals, indices };
}
