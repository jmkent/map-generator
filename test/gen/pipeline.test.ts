import { describe, expect, it } from "vitest";

import { generateVillage, DEFAULT_PARAMS } from "../../src/gen/pipeline";
import { area, isSimple, isCCW, bounds } from "../../src/gen/geometry/polygon";

describe("generateVillage determinism", () => {
    it("is byte-identical for the same seed", () => {
        expect(generateVillage("village")).toEqual(generateVillage("village"));
    });

    it("differs for different seeds", () => {
        expect(generateVillage("village")).not.toEqual(generateVillage("hamlet"));
    });

    it("threads the seed and params into the model", () => {
        const model = generateVillage("village", { radius: 120 });
        expect(model.seed).toBe("village");
        expect(model.params.radius).toBe(120);
        expect(model.params.boundaryPoints).toBe(DEFAULT_PARAMS.boundaryPoints);
    });
});

describe("boundary invariants", () => {
    const seeds = ["village", "hamlet", "riverford", "0", "zzz"];

    for (const seed of seeds) {
        it(`produces a valid boundary for seed "${seed}"`, () => {
            const model = generateVillage(seed);
            const { boundary, params } = model;

            expect(boundary).toHaveLength(params.boundaryPoints);
            expect(isSimple(boundary)).toBe(true);
            expect(isCCW(boundary)).toBe(true);

            // Every vertex radius stays within the irregularity band of the mean.
            const lo = params.radius * (1 - params.boundaryIrregularity);
            const hi = params.radius * (1 + params.boundaryIrregularity);
            for (const v of boundary) {
                const r = Math.hypot(v.x - model.site.anchor.x, v.y - model.site.anchor.y);
                expect(r).toBeGreaterThanOrEqual(lo - 1e-9);
                expect(r).toBeLessThanOrEqual(hi + 1e-9);
            }

            // Area sits between the inscribed and circumscribed circle areas.
            expect(area(boundary)).toBeGreaterThan(Math.PI * lo * lo * 0.5);
            expect(area(boundary)).toBeLessThan(Math.PI * hi * hi);
        });
    }

    it("derives model bounds from the boundary", () => {
        const model = generateVillage("village");
        expect(model.bounds).toEqual(bounds(model.boundary));
    });

    it("expands village bounds into the map extent", () => {
        const model = generateVillage("map-bounds");
        expect(model.mapBounds.minX).toBeLessThan(model.bounds.minX);
        expect(model.mapBounds.minY).toBeLessThan(model.bounds.minY);
        expect(model.mapBounds.maxX).toBeGreaterThan(model.bounds.maxX);
        expect(model.mapBounds.maxY).toBeGreaterThan(model.bounds.maxY);
    });
});
