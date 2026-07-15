// Water mesher: flat ribbon quads for flowing river channels. PURE.

import type { WaterBody } from "../../gen/types";
import { normalize, perp, sub } from "../../gen/geometry/vec2";
import type { GeometryData } from "../geometryData";

export function waterGeometry(water: readonly WaterBody[], y = 0): GeometryData {
    const segments = water.flatMap((body) => body.kind === "river"
        ? body.path.slice(1).map((point, index) => ({ a: body.path[index], b: point, width: body.width }))
        : []);
    const positions = new Float32Array(segments.length * 12);
    const normals = new Float32Array(segments.length * 12);
    const indices = new Uint32Array(segments.length * 6);

    segments.forEach((segment, index) => {
        const normal = normalize(perp(sub(segment.b, segment.a)));
        const half = { x: normal.x * segment.width / 2, y: normal.y * segment.width / 2 };
        const corners = [
            { x: segment.a.x - half.x, y: segment.a.y - half.y },
            { x: segment.a.x + half.x, y: segment.a.y + half.y },
            { x: segment.b.x + half.x, y: segment.b.y + half.y },
            { x: segment.b.x - half.x, y: segment.b.y - half.y },
        ];
        const base = index * 4;
        corners.forEach((corner, cornerIndex) => {
            const offset = (base + cornerIndex) * 3;
            positions[offset] = corner.x;
            positions[offset + 1] = y;
            positions[offset + 2] = corner.y;
            normals[offset + 1] = 1;
        });
        const offset = index * 6;
        indices[offset] = base;
        indices[offset + 1] = base + 2;
        indices[offset + 2] = base + 1;
        indices[offset + 3] = base;
        indices[offset + 4] = base + 3;
        indices[offset + 5] = base + 2;
    });
    return { positions, normals, indices };
}
