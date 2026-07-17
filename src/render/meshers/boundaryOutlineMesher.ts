// Boundary outline mesher: a dashed ribbon tracing the village extent, so the
// interactive scene marks the boundary as an outline over the grass rather than
// filling it as a patch. Mirrors the SVG renderer's dashed extent line. PURE —
// emits GeometryData; the Babylon upload lives in the Renderer.

import type { Polygon, Vec2 } from "../../gen/types";
import { normalize, perp, sub } from "../../gen/geometry/vec2";
import type { GeometryData } from "../geometryData";

export interface OutlineOptions {
    /** Dash length in world units. */
    dash?: number;
    /** Gap between dashes in world units. */
    gap?: number;
    /** Ribbon width in world units. */
    width?: number;
}

/** Trace the closed polygon as evenly spaced dash quads on the y-plane. */
export function boundaryOutlineGeometry(poly: Polygon, y = 0, options: OutlineOptions = {}): GeometryData {
    const dash = options.dash ?? 6;
    const gap = options.gap ?? 4;
    const width = options.width ?? 1.5;

    // Closed polyline with cumulative arc lengths, so a dash can be sampled by
    // distance along the perimeter regardless of where vertices fall.
    const ring = [...poly, poly[0]];
    const cumulative = [0];
    for (let i = 1; i < ring.length; i++) {
        cumulative.push(cumulative[i - 1] + Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y));
    }
    const perimeter = cumulative[cumulative.length - 1];

    const sampleAt = (s: number): Vec2 => {
        const clamped = Math.min(Math.max(s, 0), perimeter);
        let seg = 1;
        while (seg < cumulative.length - 1 && cumulative[seg] < clamped) seg++;
        const segLen = cumulative[seg] - cumulative[seg - 1];
        const t = segLen === 0 ? 0 : (clamped - cumulative[seg - 1]) / segLen;
        return {
            x: ring[seg - 1].x + (ring[seg].x - ring[seg - 1].x) * t,
            y: ring[seg - 1].y + (ring[seg].y - ring[seg - 1].y) * t,
        };
    };

    // The dash count depends on the perimeter, so collect endpoints first.
    const dashes: Array<[Vec2, Vec2]> = [];
    for (let s = 0; s < perimeter; s += dash + gap) {
        const a = sampleAt(s);
        const b = sampleAt(Math.min(s + dash, perimeter));
        if (a.x !== b.x || a.y !== b.y) dashes.push([a, b]);
    }

    const positions = new Float32Array(dashes.length * 4 * 3);
    const normals = new Float32Array(dashes.length * 4 * 3);
    const indices = new Uint32Array(dashes.length * 6);

    dashes.forEach(([a, b], i) => {
        const half = normalize(perp(sub(b, a)));
        const hx = half.x * width * 0.5;
        const hy = half.y * width * 0.5;

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

        // Two triangles, wound to face +Y (matches the road/boundary meshers).
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
