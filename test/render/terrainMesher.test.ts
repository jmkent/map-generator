import { describe, expect, it } from "vitest";

import { generateVillage } from "../../src/gen/pipeline";
import { TERRAIN_BASE_Y, terrainBandMeshes, mapFrameGeometry } from "../../src/render/meshers/terrainMesher";

function faceY(positions: Float32Array, a: number, b: number, c: number): number {
    const ax = positions[a * 3];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const bz = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cz = positions[c * 3 + 2];
    return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

function expectLiteGroundWinding(positions: Float32Array, indices: Uint32Array): void {
    for (let i = 0; i < indices.length; i += 3) {
        expect(faceY(positions, indices[i], indices[i + 1], indices[i + 2])).toBeLessThan(0);
    }
}

describe("terrainBandMeshes", () => {
    const terrain = generateVillage("relief", { terrainProfile: "coast" }).terrain;
    const meshes = terrainBandMeshes(terrain);

    it("partitions every grid cell into exactly one flat-colored band (no gaps/overlap)", () => {
        expect(meshes.length).toBeGreaterThan(3); // coast spans several bands
        const totalTris = meshes.reduce((sum, m) => sum + m.geometry.indices.length, 0);
        expect(totalTris).toBe((terrain.resolution - 1) ** 2 * 6); // one quad (2 tris) per cell
        for (const { color, geometry } of meshes) {
            expect(color).toMatch(/^#[0-9a-f]{6}$/);
            expect(geometry.positions.length % 3).toBe(0);
            expect(geometry.positions.length / 3).toBeLessThanOrEqual((geometry.indices.length / 6) * 4);
            expect([...geometry.positions].every(Number.isFinite)).toBe(true);
            for (const i of geometry.indices) expect(i).toBeLessThan(geometry.positions.length / 3);
        }
    });

    it("colors low bands blue (sea) and high bands land, for coast terrain", () => {
        const lum = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
        const [r0, g0, b0] = lum(meshes[0].color); // lowest band = deepest water
        expect(b0).toBeGreaterThan(r0);
        expect(b0).toBeGreaterThan(g0);
        const [, gTop, bTop] = lum(meshes[meshes.length - 1].color); // highest band = land/peak
        expect(bTop).toBeLessThanOrEqual(gTop + 40); // not blue-dominant
    });

    it("shares grid vertices while retaining Lite ground winding above the stage base", () => {
        for (const { geometry } of meshes) {
            for (let i = 1; i < geometry.positions.length; i += 3) expect(geometry.positions[i]).toBeGreaterThan(TERRAIN_BASE_Y - 0.2);
            expectLiteGroundWinding(geometry.positions, geometry.indices);
        }
    });
});

describe("mapFrameGeometry", () => {
    it("emits four border quads on the y-plane around the bounds", () => {
        const geo = mapFrameGeometry({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1, 0.05);
        expect(geo.positions).toHaveLength(4 * 4 * 3);
        expect(geo.indices).toHaveLength(4 * 6);
        for (let i = 0; i < geo.positions.length; i += 3) expect(geo.positions[i + 1]).toBeCloseTo(0.05, 6);
        const xs: number[] = [];
        for (let i = 0; i < geo.positions.length; i += 3) xs.push(geo.positions[i]);
        expect(Math.min(...xs)).toBeCloseTo(-1, 6);
        expect(Math.max(...xs)).toBeCloseTo(11, 6);
        for (const index of geo.indices) expect(index).toBeLessThan(geo.positions.length / 3);
    });
});
