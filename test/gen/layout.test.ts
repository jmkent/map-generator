import { describe, expect, it } from "vitest";

import type { ResolvedSettlementProfile } from "../../src/gen/types";
import { generateVillage } from "../../src/gen/pipeline";
import { contains, convexOverlap } from "../../src/gen/geometry/polygon";

const PROFILES: ResolvedSettlementProfile[] = [
    "estate",
    "weiler",
    "haufendorf",
    "reihendorf",
    "tenement",
    "angerdorf",
    "rundling",
];

describe("settlement layout profiles", () => {
    for (const profile of PROFILES) {
        it(`generates an occupied ${profile} layout`, () => {
            // Flat terrain so entrance count is not trimmed by the sea (a coast can
            // legitimately drop below approachRoadMin); this checks morphology.
            const model = generateVillage("m5-profile", { settlementProfile: profile, terrainProfile: "plain" });

            expect(model.settlement.profile).toBe(profile);
            expect(model.roads.nodes.length).toBeGreaterThan(1);
            expect(model.roads.edges.length).toBeGreaterThan(0);
            expect(model.roads.edges.filter((edge) => edge.kind === "approach").length).toBeGreaterThanOrEqual(model.params.approachRoadMin);
            expect(model.parcels.length).toBeGreaterThan(0);
            expect(model.buildings.length).toBeGreaterThan(0);
            expect(model.parcels.every((parcel) => parcel.roadKind !== "track")).toBe(true);
        });
    }

    it("selects an auto profile deterministically without perturbing other stages", () => {
        const first = generateVillage("auto-profile");
        const second = generateVillage("auto-profile");

        expect(first.settlement).toEqual(second.settlement);
        expect(first).toEqual(second);
    });

    for (const profile of ["angerdorf", "rundling"] as const) {
        it(`reserves the civic green for ${profile}`, () => {
            const model = generateVillage("civic-space", { settlementProfile: profile });
            expect(model.civicSpaces).toHaveLength(1);
            const green = model.civicSpaces[0].polygon;

            for (const parcel of model.parcels) {
                expect(convexOverlap(parcel.polygon, green, 0)).toBe(false);
            }
            for (const building of model.buildings) {
                expect(building.footprint.every((point) => !contains(green, point))).toBe(true);
            }
        });
    }

    it("uses a substantially deeper frontage band for tenement plots", () => {
        const reihendorf = generateVillage("frontage-depth", { settlementProfile: "reihendorf" });
        const tenement = generateVillage("frontage-depth", { settlementProfile: "tenement" });
        const meanDepth = (model: typeof reihendorf) =>
            model.parcels.reduce((sum, parcel) => sum + Math.hypot(
                parcel.polygon[2].x - parcel.polygon[1].x,
                parcel.polygon[2].y - parcel.polygon[1].y,
            ), 0) / model.parcels.length;

        expect(meanDepth(tenement)).toBeGreaterThan(meanDepth(reihendorf) * 1.6);
    });
});
