import { describe, expect, it } from "vitest";

import type { Polygon } from "../../src/gen/types";
import { boundaryGeometry } from "../../src/render/meshers/boundaryMesher";
import { bounds } from "../../src/gen/geometry/polygon";
import { generateVillage } from "../../src/gen/pipeline";

const SQUARE: Polygon = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
];

describe("boundaryGeometry", () => {
    it("emits centroid + ring vertices and one triangle per edge", () => {
        const geo = boundaryGeometry(SQUARE);
        expect(geo.positions).toHaveLength((SQUARE.length + 1) * 3);
        expect(geo.normals).toHaveLength((SQUARE.length + 1) * 3);
        expect(geo.indices).toHaveLength(SQUARE.length * 3);
    });

    it("places the mesh on the y-plane with upward normals", () => {
        const geo = boundaryGeometry(SQUARE, 0.5);
        for (let i = 0; i < geo.positions.length; i += 3) {
            expect(geo.positions[i + 1]).toBe(0.5);
        }
        for (let i = 0; i < geo.normals.length; i += 3) {
            expect([geo.normals[i], geo.normals[i + 1], geo.normals[i + 2]]).toEqual([0, 1, 0]);
        }
    });

    it("maps generation (x,y) to world (x,z) and keeps indices in range", () => {
        const geo = boundaryGeometry(SQUARE);
        // Ring vertex 1 (index 1) corresponds to SQUARE[0] = (-1,-1) -> (-1,0,-1).
        expect([geo.positions[3], geo.positions[4], geo.positions[5]]).toEqual([-1, 0, -1]);
        const vertexCount = SQUARE.length + 1;
        for (const idx of geo.indices) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(vertexCount);
        }
    });

    it("covers the model bounds for a generated village", () => {
        const model = generateVillage("village");
        const geo = boundaryGeometry(model.boundary);
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < geo.positions.length; i += 3) {
            minX = Math.min(minX, geo.positions[i]);
            maxX = Math.max(maxX, geo.positions[i]);
            minZ = Math.min(minZ, geo.positions[i + 2]);
            maxZ = Math.max(maxZ, geo.positions[i + 2]);
        }
        const b = bounds(model.boundary);
        expect(minX).toBeCloseTo(b.minX, 4);
        expect(maxX).toBeCloseTo(b.maxX, 4);
        expect(minZ).toBeCloseTo(b.minY, 4);
        expect(maxZ).toBeCloseTo(b.maxY, 4);
    });
});
