import { describe, expect, it } from "vitest";

import { boundsCenter, boundsRadius, boundsSize, type Bounds } from "../../src/gen/types";

describe("bounds helpers", () => {
    const cases: Array<{
        name: string;
        b: Bounds;
        center: { x: number; y: number };
        size: { width: number; height: number };
        radius: number;
    }> = [
        {
            name: "centered square",
            b: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
            center: { x: 0, y: 0 },
            size: { width: 200, height: 200 },
            radius: Math.hypot(200, 200) / 2,
        },
        {
            name: "offset rectangle",
            b: { minX: 10, minY: 20, maxX: 30, maxY: 80 },
            center: { x: 20, y: 50 },
            size: { width: 20, height: 60 },
            radius: Math.hypot(20, 60) / 2,
        },
        {
            name: "degenerate point",
            b: { minX: 5, minY: 5, maxX: 5, maxY: 5 },
            center: { x: 5, y: 5 },
            size: { width: 0, height: 0 },
            radius: 0,
        },
    ];

    for (const c of cases) {
        it(`computes center/size/radius for ${c.name}`, () => {
            expect(boundsCenter(c.b)).toEqual(c.center);
            expect(boundsSize(c.b)).toEqual(c.size);
            expect(boundsRadius(c.b)).toBeCloseTo(c.radius, 10);
        });
    }
});
