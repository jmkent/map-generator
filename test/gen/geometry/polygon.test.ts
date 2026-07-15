import { describe, expect, it } from "vitest";

import type { Polygon } from "../../../src/gen/types";
import * as P from "../../../src/gen/geometry/polygon";

// CCW unit square [0,1]^2 and a CCW right triangle.
const SQUARE: Polygon = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
];
const TRIANGLE: Polygon = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 3 },
];

function regularPolygon(n: number, radius: number): Polygon {
    const poly: Polygon = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        poly.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
    }
    return poly;
}

describe("area and winding", () => {
    it("computes signed area with CCW positive", () => {
        expect(P.signedArea(SQUARE)).toBeCloseTo(1, 10);
        expect(P.signedArea([...SQUARE].reverse())).toBeCloseTo(-1, 10);
        expect(P.area(TRIANGLE)).toBeCloseTo(6, 10);
    });

    it("reports winding and can normalize it", () => {
        expect(P.isCCW(SQUARE)).toBe(true);
        expect(P.isCCW([...SQUARE].reverse())).toBe(false);
        expect(P.isCCW(P.ensureCCW([...SQUARE].reverse()))).toBe(true);
    });

    it("computes perimeter", () => {
        expect(P.perimeter(SQUARE)).toBeCloseTo(4, 10);
        expect(P.perimeter(TRIANGLE)).toBeCloseTo(12, 10); // 3 + 4 + 5
    });
});

describe("centroid", () => {
    it("is the center for a square and the 1/3 point for a triangle", () => {
        expect(P.centroid(SQUARE)).toEqual({ x: 0.5, y: 0.5 });
        const c = P.centroid(TRIANGLE);
        expect(c.x).toBeCloseTo(4 / 3, 10);
        expect(c.y).toBeCloseTo(1, 10);
    });
});

describe("contains", () => {
    it("classifies inside and outside points", () => {
        expect(P.contains(SQUARE, { x: 0.5, y: 0.5 })).toBe(true);
        expect(P.contains(SQUARE, { x: -0.5, y: 0.5 })).toBe(false);
        expect(P.contains(SQUARE, { x: 1.5, y: 0.5 })).toBe(false);
        expect(P.contains(TRIANGLE, { x: 0.5, y: 0.5 })).toBe(true);
        expect(P.contains(TRIANGLE, { x: 3, y: 3 })).toBe(false);
    });

    it("measures distance to the boundary for on-edge points", () => {
        expect(P.distanceToBoundary(SQUARE, { x: 0.5, y: 0 })).toBeCloseTo(0, 10);
        expect(P.distanceToBoundary(SQUARE, { x: 0.5, y: 0.5 })).toBeCloseTo(0.5, 10);
    });
});

describe("isSimple", () => {
    it("accepts simple polygons and rejects a self-intersecting bowtie", () => {
        expect(P.isSimple(SQUARE)).toBe(true);
        expect(P.isSimple(regularPolygon(12, 5))).toBe(true);
        const bowtie: Polygon = [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
        ];
        expect(P.isSimple(bowtie)).toBe(false);
    });
});

describe("inset", () => {
    it("shrinks area monotonically while preserving CCW winding", () => {
        const poly = regularPolygon(24, 10);
        const a0 = P.area(poly);
        const a1 = P.area(P.inset(poly, 1));
        const a2 = P.area(P.inset(poly, 2));
        expect(a1).toBeLessThan(a0);
        expect(a2).toBeLessThan(a1);
        expect(P.isCCW(P.inset(poly, 2))).toBe(true);
    });

    it("insets a unit square by a known amount", () => {
        const inner = P.inset(SQUARE, 0.25);
        // A 0.25 inset of the unit square yields the [0.25,0.75]^2 square.
        expect(P.area(inner)).toBeCloseTo(0.25, 6);
        const b = P.bounds(inner);
        expect(b.minX).toBeCloseTo(0.25, 6);
        expect(b.maxX).toBeCloseTo(0.75, 6);
    });
});
