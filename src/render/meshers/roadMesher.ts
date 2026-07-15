// Road mesher: one flat quad ribbon per road edge, on the y-plane. PURE — emits
// GeometryData; the Babylon upload lives in the Renderer.
//
// Per-edge quads (rather than a mitered strip) leave small gaps/overlaps at
// bends; with thin roads and gentle curves these are visually negligible.
// Mitered joins can replace this later without changing the mesher's contract.

import type { RoadNetwork, Vec2 } from "../../gen/types";
import { normalize, perp, sub } from "../../gen/geometry/vec2";
import type { GeometryData } from "../geometryData";

export function roadGeometry(network: RoadNetwork, y = 0): GeometryData {
    const posById = new Map<number, Vec2>();
    for (const node of network.nodes) posById.set(node.id, node.pos);

    // Skip degenerate edges up front so vertex/index counts stay consistent.
    const edges = network.edges.filter((e) => {
        const a = posById.get(e.a);
        const b = posById.get(e.b);
        return a !== undefined && b !== undefined && (a.x !== b.x || a.y !== b.y);
    });

    const positions = new Float32Array(edges.length * 4 * 3);
    const normals = new Float32Array(edges.length * 4 * 3);
    const indices = new Uint32Array(edges.length * 6);

    edges.forEach((edge, i) => {
        const a = posById.get(edge.a)!;
        const b = posById.get(edge.b)!;
        const half = normalize(perp(sub(b, a)));
        const hx = half.x * edge.width * 0.5;
        const hy = half.y * edge.width * 0.5;

        // Quad corners: a-left, a-right, b-right, b-left. (x,y) -> world (x,0,y).
        const corners: Array<[number, number]> = [
            [a.x - hx, a.y - hy],
            [a.x + hx, a.y + hy],
            [b.x + hx, b.y + hy],
            [b.x - hx, b.y - hy],
        ];
        const base = i * 4;
        corners.forEach(([cx, cy], c) => {
            const o = (base + c) * 3;
            positions[o] = cx;
            positions[o + 1] = y;
            positions[o + 2] = cy;
            normals[o + 1] = 1;
        });

        // Two triangles, wound to face +Y (matches the boundary mesher's winding).
        const io = i * 6;
        indices[io] = base;
        indices[io + 1] = base + 2;
        indices[io + 2] = base + 1;
        indices[io + 3] = base;
        indices[io + 4] = base + 3;
        indices[io + 5] = base + 2;
    });

    return { positions, normals, indices };
}
