// Marching-squares iso-contours of a scalar grid. PURE — no Babylon, no randomness.
//
// Used to trace a shoreline (the height == seaLevel isoline) from the terrain
// height field. The grid is treated as if ringed by a border of "above threshold"
// values, so regions below the threshold never reach the border and every contour
// closes into a loop. Loops are oriented so the below-threshold region is on the
// left: a loop enclosing a below region is CCW (positive signed area), a loop
// enclosing an above island is CW.

import type { Vec2 } from "../types";
import { dedupeRing } from "./polygon";

export interface ContourGrid {
    /** Row-major scalar values, length cols*rows. */
    values: readonly number[];
    cols: number;
    rows: number;
    /** Map integer grid coordinates (which may fall one step outside) to world space. */
    toWorld: (col: number, row: number) => Vec2;
}

const KEY_SCALE = 1e4;
const key = (p: Vec2): string => `${Math.round(p.x * KEY_SCALE)},${Math.round(p.y * KEY_SCALE)}`;

/** Extract closed iso-contour loops at `threshold`. */
export function isoContours(grid: ContourGrid, threshold: number): Vec2[][] {
    // A finite "land" sentinel for the surrounding border and out-of-range corners,
    // above the threshold so below-regions stay enclosed. Using the grid maximum
    // keeps near-border crossings on a sensible scale (vs +Infinity, which is NaN
    // under linear interpolation).
    let border = threshold;
    for (const v of grid.values) if (v > border) border = v;
    border += 1;

    const valueAt = (col: number, row: number): number =>
        col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? border : grid.values[row * grid.cols + col];

    const segments: Array<{ from: Vec2; to: Vec2 }> = [];

    // Iterate cells including a one-step border ring so edge-touching regions close.
    for (let row = -1; row < grid.rows; row++) {
        for (let col = -1; col < grid.cols; col++) {
            const corners: Array<{ col: number; row: number }> = [
                { col, row },           // 0: top-left
                { col: col + 1, row },  // 1: top-right
                { col: col + 1, row: row + 1 }, // 2: bottom-right
                { col, row: row + 1 },  // 3: bottom-left
            ];
            const values = corners.map((c) => valueAt(c.col, c.row));
            const below = values.map((v) => v < threshold);
            const mask = (below[0] ? 1 : 0) | (below[1] ? 2 : 0) | (below[2] ? 4 : 0) | (below[3] ? 8 : 0);
            if (mask === 0 || mask === 15) continue;

            const world = corners.map((c) => grid.toWorld(c.col, c.row));
            // Crossing point on the edge between corner a and corner b (one below, one above).
            const crossing = (a: number, b: number): Vec2 => {
                const t = (threshold - values[a]) / (values[b] - values[a]);
                return { x: world[a].x + (world[b].x - world[a].x) * t, y: world[a].y + (world[b].y - world[a].y) * t };
            };
            const edgePoints: Record<number, Vec2> = {};
            // Edges: 0 top(0-1), 1 right(1-2), 2 bottom(2-3), 3 left(3-0).
            if (below[0] !== below[1]) edgePoints[0] = crossing(0, 1);
            if (below[1] !== below[2]) edgePoints[1] = crossing(1, 2);
            if (below[2] !== below[3]) edgePoints[2] = crossing(2, 3);
            if (below[3] !== below[0]) edgePoints[3] = crossing(3, 0);

            const belowCentroid = (): Vec2 => {
                let sx = 0;
                let sy = 0;
                let n = 0;
                for (let i = 0; i < 4; i++) if (below[i]) { sx += world[i].x; sy += world[i].y; n++; }
                return { x: sx / n, y: sy / n };
            };
            const orient = (p: Vec2, q: Vec2): void => {
                // Keep the below region on the left of p->q (cross(q-p, c-p) > 0).
                const c = belowCentroid();
                const left = (q.x - p.x) * (c.y - p.y) - (q.y - p.y) * (c.x - p.x);
                segments.push(left >= 0 ? { from: p, to: q } : { from: q, to: p });
            };

            const present = [0, 1, 2, 3].filter((e) => e in edgePoints);
            if (present.length === 2) {
                orient(edgePoints[present[0]], edgePoints[present[1]]);
            } else if (present.length === 4) {
                // Saddle: connect opposite edges (top-left with bottom-right pairing)
                // based on the cell-center value, then orient each.
                const centerBelow = (values[0] + values[1] + values[2] + values[3]) / 4 < threshold;
                if (centerBelow) {
                    orient(edgePoints[0], edgePoints[1]);
                    orient(edgePoints[2], edgePoints[3]);
                } else {
                    orient(edgePoints[0], edgePoints[3]);
                    orient(edgePoints[2], edgePoints[1]);
                }
            }
        }
    }

    return stitch(segments);
}

/** Connect directed segments end-to-start into closed loops. */
function stitch(segments: Array<{ from: Vec2; to: Vec2 }>): Vec2[][] {
    const byStart = new Map<string, Array<{ from: Vec2; to: Vec2; used: boolean }>>();
    const entries = segments.map((s) => ({ ...s, used: false }));
    for (const seg of entries) {
        const k = key(seg.from);
        (byStart.get(k) ?? byStart.set(k, []).get(k)!).push(seg);
    }

    const loops: Vec2[][] = [];
    for (const start of entries) {
        if (start.used) continue;
        const loop: Vec2[] = [];
        let current: typeof start | undefined = start;
        while (current && !current.used) {
            current.used = true;
            loop.push(current.from);
            const candidates = byStart.get(key(current.to));
            current = candidates?.find((s) => !s.used);
        }
        if (loop.length >= 3) loops.push(dedupeRing(loop));
    }
    return loops;
}
