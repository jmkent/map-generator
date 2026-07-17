import { describe, expect, it } from "vitest";

import type { Polygon } from "../../src/gen/types";
import { boundaryOutlineGeometry } from "../../src/render/meshers/boundaryOutlineMesher";
import { bounds } from "../../src/gen/geometry/polygon";
import { generateVillage } from "../../src/gen/pipeline";

// A 40-unit square: perimeter 160, so with dash+gap = 10 it yields 16 dashes.
const SQUARE: Polygon = [
    { x: -20, y: -20 },
    { x: 20, y: -20 },
    { x: 20, y: 20 },
    { x: -20, y: 20 },
];

describe("boundaryOutlineGeometry", () => {
    it("emits one quad (4 verts, 6 indices) per dash", () => {
        const geo = boundaryOutlineGeometry(SQUARE, 0, { dash: 6, gap: 4, width: 1.5 });
        const dashes = geo.positions.length / (4 * 3);
        expect(dashes).toBe(16);
        expect(geo.normals).toHaveLength(dashes * 4 * 3);
        expect(geo.indices).toHaveLength(dashes * 6);
    });

    it("places dashes on the y-plane with upward normals and in-range indices", () => {
        const geo = boundaryOutlineGeometry(SQUARE, 0.1);
        const vertexCount = geo.positions.length / 3;
        for (let i = 0; i < geo.positions.length; i += 3) {
            expect(geo.positions[i + 1]).toBeCloseTo(0.1, 5);
            expect(geo.normals[i + 1]).toBe(1);
        }
        for (const idx of geo.indices) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(vertexCount);
        }
        expect([...geo.positions].every(Number.isFinite)).toBe(true);
    });

    it("stays within the boundary extent (plus half the ribbon width) for a village", () => {
        const model = generateVillage("village");
        const width = 1.5;
        const geo = boundaryOutlineGeometry(model.boundary, 0.1, { width });
        expect(geo.indices.length).toBeGreaterThan(0);
        const b = bounds(model.boundary);
        for (let i = 0; i < geo.positions.length; i += 3) {
            expect(geo.positions[i]).toBeGreaterThanOrEqual(b.minX - width);
            expect(geo.positions[i]).toBeLessThanOrEqual(b.maxX + width);
            expect(geo.positions[i + 2]).toBeGreaterThanOrEqual(b.minY - width);
            expect(geo.positions[i + 2]).toBeLessThanOrEqual(b.maxY + width);
        }
    });
});
