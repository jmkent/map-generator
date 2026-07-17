import { describe, expect, it } from "vitest";

import { generateVillage } from "../../src/gen/pipeline";
import { terrainGeometry } from "../../src/render/meshers/terrainMesher";

const PROFILES = ["plain", "river-valley", "lakeshore", "coast", "cove", "peninsula", "ridge", "hillside", "island"] as const;

describe("terrain-first generation", () => {
    for (const terrainProfile of PROFILES) {
        it(`generates deterministic, finite ${terrainProfile} terrain`, () => {
            const first = generateVillage("terrain-profile", { terrainProfile });
            const second = generateVillage("terrain-profile", { terrainProfile });
            expect(first.terrain).toEqual(second.terrain);
            expect(first.terrain.profile).toBe(terrainProfile);
            expect(first.mapBounds).toEqual(first.terrain.bounds);
            expect(first.terrain.samples).toHaveLength(first.terrain.resolution ** 2);
            expect(first.terrain.samples.every((sample) => Number.isFinite(sample.height) && Number.isFinite(sample.slope))).toBe(true);
            expect(first.terrain.samples.some((sample) => sample.buildable)).toBe(true);
        });
    }

    it("emits a finite raised mesh for the terrain field", () => {
        const terrain = generateVillage("terrain-mesh", { terrainProfile: "ridge" }).terrain;
        const geometry = terrainGeometry(terrain);
        expect(geometry.positions).toHaveLength(terrain.resolution ** 2 * 3);
        expect(geometry.indices).toHaveLength((terrain.resolution - 1) ** 2 * 6);
        expect([...geometry.positions].every(Number.isFinite)).toBe(true);
    });

    it("uses terrain type to select hydrology and settlement orientation", () => {
        const valley = generateVillage("terrain-water", { terrainProfile: "river-valley" });
        const cove = generateVillage("terrain-water", { terrainProfile: "cove", riverChance: 0 });
        const lake = generateVillage("terrain-water", { terrainProfile: "lakeshore", riverChance: 0 });

        expect(valley.water.some((body) => body.kind === "river")).toBe(true);
        expect(cove.water.some((body) => body.kind === "coast")).toBe(true);
        expect(lake.water.some((body) => body.kind === "lake")).toBe(true);
        expect(Math.abs(valley.settlement.axis.y)).toBeGreaterThan(0.99);
        expect(Math.abs(cove.settlement.axis.x)).toBeGreaterThan(0.99);
        expect(valley.terrain.hydrology).toEqual(valley.water);
        expect(valley.terrain.samples.some((sample) => !sample.land && !sample.buildable)).toBe(true);
    });
});
