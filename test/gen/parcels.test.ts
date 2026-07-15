import { describe, expect, it } from "vitest";

import type { MapModel, Polygon, RoadNetwork } from "../../src/gen/types";
import { generateVillage } from "../../src/gen/pipeline";
import { contains, convexOverlap, ensureCCW } from "../../src/gen/geometry/polygon";
import { add, normalize, perp, scale, sub } from "../../src/gen/geometry/vec2";

const SEEDS = ["village", "hamlet", "riverford", "0", "zzz", "mistmoor"];
const TOL = 0.05;

function roadCorridors(net: RoadNetwork): Polygon[] {
    const pos = new Map(net.nodes.map((n) => [n.id, n.pos]));
    return net.edges.map((e) => {
        const a = pos.get(e.a)!;
        const b = pos.get(e.b)!;
        const h = scale(normalize(perp(sub(b, a))), e.width / 2);
        return ensureCCW([sub(a, h), add(a, h), add(b, h), sub(b, h)]);
    });
}

describe("parcel invariants", () => {
    for (const seed of SEEDS) {
        it(`produces valid lots for seed "${seed}"`, () => {
            const model: MapModel = generateVillage(seed, { settlementProfile: "haufendorf" });
            const parcels = model.parcels;

            expect(parcels.length).toBeGreaterThan(8);

            // Every lot lies inside the boundary.
            for (const parcel of parcels) {
                for (const c of parcel.polygon) {
                    expect(contains(model.boundary, c)).toBe(true);
                }
            }

            // Lots do not overlap each other (touching edges allowed).
            for (let i = 0; i < parcels.length; i++) {
                for (let j = i + 1; j < parcels.length; j++) {
                    expect(convexOverlap(parcels[i].polygon, parcels[j].polygon, TOL)).toBe(false);
                }
            }

            // Lots do not overlap road corridors.
            const corridors = roadCorridors(model.roads);
            for (const parcel of parcels) {
                for (const corridor of corridors) {
                    expect(convexOverlap(parcel.polygon, corridor, TOL)).toBe(false);
                }
            }
        });
    }

    it("covers a meaningful share of the boundary without exceeding it", () => {
        const model = generateVillage("village", { settlementProfile: "haufendorf" });
        const totalLotArea = model.parcels.reduce((sum, p) => sum + polygonArea(p.polygon), 0);
        expect(totalLotArea).toBeGreaterThan(0);
        expect(totalLotArea).toBeLessThan(polygonArea(model.boundary));
    });
});

describe("parcel determinism", () => {
    it("is identical for the same seed", () => {
        expect(generateVillage("village").parcels).toEqual(generateVillage("village").parcels);
    });

    it("differs across seeds", () => {
        expect(generateVillage("village").parcels).not.toEqual(generateVillage("hamlet").parcels);
    });
});

function polygonArea(poly: Polygon): number {
    let sum = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    }
    return Math.abs(sum) / 2;
}
