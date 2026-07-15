import { describe, expect, it } from "vitest";

import * as V from "../../../src/gen/geometry/vec2";

describe("vec2", () => {
    it("adds, subtracts, scales", () => {
        expect(V.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
        expect(V.sub({ x: 3, y: 4 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 2 });
        expect(V.scale({ x: 2, y: -3 }, 2)).toEqual({ x: 4, y: -6 });
    });

    it("dot and cross", () => {
        expect(V.dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0);
        expect(V.dot({ x: 2, y: 3 }, { x: 4, y: 5 })).toBe(23);
        expect(V.cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
        expect(V.cross({ x: 0, y: 1 }, { x: 1, y: 0 })).toBe(-1);
    });

    it("length and normalize", () => {
        expect(V.length({ x: 3, y: 4 })).toBe(5);
        expect(V.lengthSq({ x: 3, y: 4 })).toBe(25);
        const n = V.normalize({ x: 0, y: 5 });
        expect(n).toEqual({ x: 0, y: 1 });
        expect(V.normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    });

    it("perp is a 90° CCW rotation", () => {
        const a = V.perp({ x: 1, y: 0 });
        expect(a.x).toBeCloseTo(0, 12);
        expect(a.y).toBeCloseTo(1, 12);
        const b = V.perp({ x: 0, y: 1 });
        expect(b.x).toBeCloseTo(-1, 12);
        expect(b.y).toBeCloseTo(0, 12);
    });

    it("dist, lerp, rotate, equals", () => {
        expect(V.dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
        expect(V.distSq({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
        expect(V.lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
        const r = V.rotate({ x: 1, y: 0 }, Math.PI / 2);
        expect(r.x).toBeCloseTo(0, 10);
        expect(r.y).toBeCloseTo(1, 10);
        expect(V.equals({ x: 1, y: 1 }, { x: 1 + 1e-12, y: 1 })).toBe(true);
        expect(V.equals({ x: 1, y: 1 }, { x: 1.1, y: 1 })).toBe(false);
    });
});
