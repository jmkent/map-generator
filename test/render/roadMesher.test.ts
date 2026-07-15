import { describe, expect, it } from "vitest";

import type { RoadNetwork } from "../../src/gen/types";
import { roadGeometry } from "../../src/render/meshers/roadMesher";
import { generateVillage } from "../../src/gen/pipeline";

const TWO_EDGES: RoadNetwork = {
    nodes: [
        { id: 0, pos: { x: 0, y: 0 } },
        { id: 1, pos: { x: 10, y: 0 } },
        { id: 2, pos: { x: 10, y: 10 } },
    ],
    edges: [
        { a: 0, b: 1, kind: "primary", width: 4 },
        { a: 1, b: 2, kind: "lane", width: 2 },
    ],
};

describe("roadGeometry", () => {
    it("emits four vertices and six indices per edge", () => {
        const geo = roadGeometry(TWO_EDGES);
        expect(geo.positions).toHaveLength(2 * 4 * 3);
        expect(geo.normals).toHaveLength(2 * 4 * 3);
        expect(geo.indices).toHaveLength(2 * 6);
    });

    it("keeps indices in range and produces no NaNs", () => {
        const geo = roadGeometry(TWO_EDGES);
        const vertexCount = geo.positions.length / 3;
        for (const idx of geo.indices) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(vertexCount);
        }
        for (const value of geo.positions) expect(Number.isNaN(value)).toBe(false);
    });

    it("lays the ribbon flat with upward normals", () => {
        const geo = roadGeometry(TWO_EDGES, 0.04);
        for (let i = 0; i < geo.positions.length; i += 3) {
            expect(geo.positions[i + 1]).toBeCloseTo(0.04, 5);
        }
        for (let i = 0; i < geo.normals.length; i += 3) {
            expect([geo.normals[i], geo.normals[i + 1], geo.normals[i + 2]]).toEqual([0, 1, 0]);
        }
    });

    it("skips degenerate (zero-length) edges", () => {
        const net: RoadNetwork = {
            nodes: [
                { id: 0, pos: { x: 5, y: 5 } },
                { id: 1, pos: { x: 5, y: 5 } },
            ],
            edges: [{ a: 0, b: 1, kind: "primary", width: 3 }],
        };
        expect(roadGeometry(net).indices).toHaveLength(0);
    });

    it("stays within the road extent for a generated village", () => {
        const model = generateVillage("village");
        const geo = roadGeometry(model.roads);
        const maxWidth = Math.max(...model.roads.edges.map((e) => e.width));
        let minX = Infinity;
        let maxX = -Infinity;
        for (const n of model.roads.nodes) {
            minX = Math.min(minX, n.pos.x);
            maxX = Math.max(maxX, n.pos.x);
        }
        for (let i = 0; i < geo.positions.length; i += 3) {
            expect(geo.positions[i]).toBeGreaterThanOrEqual(minX - maxWidth);
            expect(geo.positions[i]).toBeLessThanOrEqual(maxX + maxWidth);
        }
    });
});
