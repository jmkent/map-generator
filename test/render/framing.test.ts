import { describe, expect, it } from "vitest";

import type { Bounds } from "../../src/gen/types";
import { boundsSize } from "../../src/gen/types";
import { frameBounds, stageNearFar } from "../../src/render/framing";

const SQUARE: Bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

describe("frameBounds", () => {
    it("targets the bounds center on the ground plane", () => {
        const bounds: Bounds = { minX: 10, minY: 20, maxX: 30, maxY: 80 };
        const { target } = frameBounds(bounds, { fovY: 0.14, aspect: 1, margin: 1 });
        expect(target).toEqual([20, 0, 50]);
    });

    it("matches the rectangle-fit radius for a square viewport", () => {
        const fovY = 0.14;
        const { radius } = frameBounds(SQUARE, { fovY, aspect: 1, margin: 1 });
        const { width, height } = boundsSize(SQUARE);
        const expected = Math.max(width, height) / 2 / Math.tan(fovY / 2);
        expect(radius).toBeCloseTo(expected, 6);
    });

    it("uses the fixed camera tilt to avoid oversized circular framing", () => {
        const flat = frameBounds(SQUARE, { fovY: 0.14, aspect: 16 / 9, margin: 1 });
        const tilted = frameBounds(SQUARE, { fovY: 0.14, aspect: 16 / 9, margin: 1, alpha: -Math.PI / 2, beta: Math.PI / 4 });
        expect(tilted.radius).toBeLessThan(flat.radius);
    });

    it("scales radius linearly with margin", () => {
        const base = frameBounds(SQUARE, { fovY: 0.14, aspect: 1, margin: 1 }).radius;
        const padded = frameBounds(SQUARE, { fovY: 0.14, aspect: 1, margin: 1.5 }).radius;
        expect(padded).toBeCloseTo(base * 1.5, 6);
    });

    it("requires a larger radius for a portrait viewport than landscape", () => {
        const params = { fovY: 0.14, margin: 1 } as const;
        const landscape = frameBounds(SQUARE, { ...params, aspect: 2 }).radius;
        const portrait = frameBounds(SQUARE, { ...params, aspect: 0.5 }).radius;
        // Portrait has a narrower horizontal FOV, so the camera must pull back more.
        expect(portrait).toBeGreaterThan(landscape);
    });

    it("is unaffected by aspect ratios >= 1 sharing the same fovY limit", () => {
        // For aspect >= 1, fovX >= fovY, so fovY is always the limiter and radius
        // is independent of aspect.
        const a = frameBounds(SQUARE, { fovY: 0.14, aspect: 1, margin: 1 }).radius;
        const b = frameBounds(SQUARE, { fovY: 0.14, aspect: 3, margin: 1 }).radius;
        expect(b).toBeCloseTo(a, 6);
    });

    it("grows radius with larger bounds", () => {
        const small = frameBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { fovY: 0.14, aspect: 1, margin: 1 }).radius;
        const large = frameBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { fovY: 0.14, aspect: 1, margin: 1 }).radius;
        expect(large).toBeGreaterThan(small);
    });

    it("rejects non-positive fovY and aspect", () => {
        expect(() => frameBounds(SQUARE, { fovY: 0, aspect: 1, margin: 1 })).toThrow();
        expect(() => frameBounds(SQUARE, { fovY: -0.1, aspect: 1, margin: 1 })).toThrow();
        expect(() => frameBounds(SQUARE, { fovY: 0.14, aspect: 0, margin: 1 })).toThrow();
    });
});

describe("stageNearFar", () => {
    it("brackets the radius by the padded bounds radius", () => {
        const { near, far } = stageNearFar(1000, 100);
        expect(near).toBe(1000 - 150);
        expect(far).toBe(1000 + 150);
        expect(near).toBeLessThan(1000);
        expect(far).toBeGreaterThan(1000);
    });

    it("floors the near plane at a small positive value", () => {
        const { near } = stageNearFar(50, 100);
        expect(near).toBe(0.1);
    });
});
