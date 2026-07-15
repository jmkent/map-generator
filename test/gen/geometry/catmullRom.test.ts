import { describe, expect, it } from "vitest";

import type { Vec2 } from "../../../src/gen/types";
import { catmullRom } from "../../../src/gen/geometry/catmullRom";

function includesPoint(curve: Vec2[], p: Vec2, eps = 1e-6): boolean {
    return curve.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= eps);
}

describe("catmullRom", () => {
    it("passes through every control point", () => {
        const pts: Vec2[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ];
        const curve = catmullRom(pts, 8);
        for (const p of pts) {
            expect(includesPoint(curve, p)).toBe(true);
        }
    });

    it("produces (n-1)*samples + 1 points", () => {
        const pts: Vec2[] = [
            { x: 0, y: 0 },
            { x: 5, y: 3 },
            { x: 9, y: -2 },
            { x: 14, y: 1 },
        ];
        expect(catmullRom(pts, 10)).toHaveLength(3 * 10 + 1);
    });

    it("stays on the line for collinear control points", () => {
        const pts: Vec2[] = [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 10, y: 0 },
        ];
        for (const q of catmullRom(pts, 6)) {
            expect(q.y).toBeCloseTo(0, 9);
        }
    });

    it("handles the two-point case as a straight segment", () => {
        const curve = catmullRom([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);
        expect(curve).toHaveLength(6);
        expect(curve[0]).toEqual({ x: 0, y: 0 });
        expect(curve[5]).toEqual({ x: 10, y: 0 });
    });

    it("is deterministic", () => {
        const pts: Vec2[] = [
            { x: 0, y: 0 },
            { x: 3, y: 7 },
            { x: 8, y: 2 },
        ];
        expect(catmullRom(pts, 12)).toEqual(catmullRom(pts, 12));
    });
});
