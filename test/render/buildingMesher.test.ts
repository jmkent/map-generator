import { describe, expect, it } from "vitest";

import { buildingInstances } from "../../src/render/meshers/buildingMesher";
import { generateVillage } from "../../src/gen/pipeline";

describe("buildingInstances", () => {
    const model = generateVillage("village");
    const instances = buildingInstances(model.buildings);

    it("emits one transform per building", () => {
        expect(instances.length).toBe(model.buildings.length);
        expect(instances.length).toBeGreaterThan(0);
    });

    it("maps center/height/dimensions into the transform", () => {
        model.buildings.forEach((b, i) => {
            const t = instances[i];
            expect(t.position[0]).toBe(b.center.x);
            expect(t.position[1]).toBeCloseTo(b.height / 2, 10);
            expect(t.position[2]).toBe(b.center.y);
            expect(t.rotationY).toBe(-b.angle);
            expect(t.scale).toEqual([b.width, b.height, b.depth]);
        });
    });

    it("produces no NaNs", () => {
        for (const t of instances) {
            for (const v of [...t.position, t.rotationY, ...t.scale]) {
                expect(Number.isNaN(v)).toBe(false);
            }
        }
    });

    it("seats every box on the ground (base at y=0)", () => {
        for (const t of instances) {
            expect(t.position[1] - t.scale[1] / 2).toBeCloseTo(0, 10);
        }
    });

    it("supports seating boxes on an elevated terrain surface", () => {
        const baseY = 0.8;
        for (const t of buildingInstances(model.buildings, baseY)) {
            expect(t.position[1] - t.scale[1] / 2).toBeCloseTo(baseY, 10);
        }
    });
});
