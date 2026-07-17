// Water mesher: flat ribbon quads for flowing river channels. PURE.

import type { WaterBody } from "../../gen/types";
import type { GeometryData } from "../geometryData";

export function waterGeometry(water: readonly WaterBody[], y = 0): GeometryData {
    const segments = water.flatMap((body) => body.kind === "river"
        ? body.path.slice(1).map((_, index) => ({
            leftA: body.leftBank[index],
            rightA: body.rightBank[index],
            leftB: body.leftBank[index + 1],
            rightB: body.rightBank[index + 1],
        }))
        : []);
    const closedBodies = water.filter((body) => body.kind !== "river");
    const riverVertexCount = segments.length * 4;
    const polygonVertexCount = closedBodies.reduce((sum, body) => sum + body.polygon.length + 1, 0);
    const positions = new Float32Array((riverVertexCount + polygonVertexCount) * 3);
    const normals = new Float32Array((riverVertexCount + polygonVertexCount) * 3);
    const indices = new Uint32Array(segments.length * 6 + closedBodies.reduce((sum, body) => sum + body.polygon.length * 3, 0));

    segments.forEach((segment, index) => {
        const corners = [
            segment.leftA,
            segment.rightA,
            segment.rightB,
            segment.leftB,
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
    let vertex = riverVertexCount;
    let index = segments.length * 6;
    for (const body of closedBodies) {
        const center = body.polygon.reduce((sum, point) => ({ x: sum.x + point.x / body.polygon.length, y: sum.y + point.y / body.polygon.length }), { x: 0, y: 0 });
        positions[vertex * 3] = center.x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = center.y;
        normals[vertex * 3 + 1] = 1;
        const centerIndex = vertex++;
        const ringStart = vertex;
        for (const point of body.polygon) {
            positions[vertex * 3] = point.x;
            positions[vertex * 3 + 1] = y;
            positions[vertex * 3 + 2] = point.y;
            normals[vertex * 3 + 1] = 1;
            vertex++;
        }
        for (let i = 0; i < body.polygon.length; i++) {
            indices[index++] = centerIndex;
            indices[index++] = ringStart + i;
            indices[index++] = ringStart + (i + 1) % body.polygon.length;
        }
    }
    return { positions, normals, indices };
}
