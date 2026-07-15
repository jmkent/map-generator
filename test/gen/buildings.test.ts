import { describe, expect, it } from "vitest";

import type { MapModel, Polygon, RoadNetwork } from "../../src/gen/types";
import { generateVillage } from "../../src/gen/pipeline";
import { createRng } from "../../src/gen/rng";
import { centroid, contains, convexOverlap, ensureCCW } from "../../src/gen/geometry/polygon";
import { add, dist, normalize, perp, scale, sub } from "../../src/gen/geometry/vec2";

const SEEDS = ["village", "hamlet", "riverford", "0", "zzz", "mistmoor"];

function roadCorridors(net: RoadNetwork): Polygon[] {
    const pos = new Map(net.nodes.map((n) => [n.id, n.pos]));
    return net.edges.map((e) => {
        const a = pos.get(e.a)!;
        const b = pos.get(e.b)!;
        const h = scale(normalize(perp(sub(b, a))), e.width / 2);
        return ensureCCW([sub(a, h), add(a, h), add(b, h), sub(b, h)]);
    });
}

describe("building invariants", () => {
    for (const seed of SEEDS) {
        it(`produces valid houses for seed "${seed}"`, () => {
            const model: MapModel = generateVillage(seed);
            const buildings = model.buildings;

            expect(buildings.length).toBeGreaterThan(5);

            for (const b of buildings) {
                expect(b.height).toBeGreaterThan(0);
                for (const c of b.footprint) {
                    expect(contains(model.boundary, c)).toBe(true);
                }
            }

            // No house-house overlap.
            for (let i = 0; i < buildings.length; i++) {
                for (let j = i + 1; j < buildings.length; j++) {
                    expect(convexOverlap(buildings[i].footprint, buildings[j].footprint, 0.01)).toBe(false);
                }
            }

            // No house-road overlap.
            const corridors = roadCorridors(model.roads);
            for (const b of buildings) {
                for (const corridor of corridors) {
                    expect(convexOverlap(b.footprint, corridor, 0.01)).toBe(false);
                }
            }
        });
    }

    it("clusters toward the center (density falloff)", () => {
        const model = generateVillage("village");
        const center = centroid(model.boundary);

        const meanBuilding =
            model.buildings.reduce((s, b) => s + dist(b.center, center), 0) / model.buildings.length;

        // Uniform samples across the boundary, for comparison.
        const rng = createRng("uniform-sampler");
        const { minX, minY, maxX, maxY } = model.bounds;
        let sum = 0;
        let count = 0;
        for (let i = 0; i < 4000; i++) {
            const p = { x: rng.float(minX, maxX), y: rng.float(minY, maxY) };
            if (contains(model.boundary, p)) {
                sum += dist(p, center);
                count++;
            }
        }
        const meanUniform = sum / count;

        expect(meanBuilding).toBeLessThan(meanUniform);
    });
});

describe("building determinism and stream isolation", () => {
    it("is identical for the same seed", () => {
        expect(generateVillage("village").buildings).toEqual(generateVillage("village").buildings);
    });

    it("changing a building param leaves boundary/roads/parcels byte-identical", () => {
        const base = generateVillage("village");
        const taller = generateVillage("village", { buildingMinHeight: 19, buildingMaxHeight: 20 });

        expect(taller.boundary).toEqual(base.boundary);
        expect(taller.roads).toEqual(base.roads);
        expect(taller.parcels).toEqual(base.parcels);
        expect(taller.buildings).not.toEqual(base.buildings);
        // Footprints unchanged; only heights differ.
        expect(taller.buildings.map((b) => b.footprint)).toEqual(base.buildings.map((b) => b.footprint));
    });
});
