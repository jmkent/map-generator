import { describe, expect, it } from "vitest";

import { createRng, hashSeed } from "../../src/gen/rng";

function draws(seed: string | number, n = 20): number[] {
    const rng = createRng(seed);
    return Array.from({ length: n }, () => rng.next());
}

describe("determinism", () => {
    it("produces an identical sequence for the same seed", () => {
        expect(draws("village")).toEqual(draws("village"));
        expect(draws(42)).toEqual(draws(42));
    });

    it("produces different sequences for different seeds", () => {
        expect(draws("village")).not.toEqual(draws("hamlet"));
    });

    it("hashes string seeds stably", () => {
        expect(hashSeed("village")).toBe(hashSeed("village"));
        expect(hashSeed("village")).not.toBe(hashSeed("hamlet"));
    });
});

describe("named streams", () => {
    it("are reproducible by name", () => {
        const a = createRng("village").stream("roads");
        const b = createRng("village").stream("roads");
        expect(Array.from({ length: 10 }, () => a.next())).toEqual(
            Array.from({ length: 10 }, () => b.next()),
        );
    });

    it("are independent of each other", () => {
        const roads = createRng("village").stream("roads");
        const houses = createRng("village").stream("houses");
        const roadDraws = Array.from({ length: 10 }, () => roads.next());
        const houseDraws = Array.from({ length: 10 }, () => houses.next());
        expect(roadDraws).not.toEqual(houseDraws);
    });

    it("are isolated from parent/sibling consumption", () => {
        // Draw the 'roads' stream after heavily consuming the parent and another
        // stream; it must match a freshly-derived 'roads' stream.
        const parent = createRng("village");
        for (let i = 0; i < 37; i++) parent.next();
        parent.stream("noise").int(0, 100);
        const roads = parent.stream("roads");

        const fresh = createRng("village").stream("roads");
        expect(Array.from({ length: 10 }, () => roads.next())).toEqual(
            Array.from({ length: 10 }, () => fresh.next()),
        );
    });
});

describe("helpers stay in range", () => {
    it("int is inclusive and within bounds", () => {
        const rng = createRng("range");
        const seen = new Set<number>();
        for (let i = 0; i < 5000; i++) {
            const n = rng.int(1, 6);
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(6);
            seen.add(n);
        }
        expect(seen).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    });

    it("float stays within [min, max)", () => {
        const rng = createRng("floats");
        for (let i = 0; i < 5000; i++) {
            const f = rng.float(-2, 5);
            expect(f).toBeGreaterThanOrEqual(-2);
            expect(f).toBeLessThan(5);
        }
    });

    it("pick returns an element", () => {
        const rng = createRng("pick");
        const items = ["a", "b", "c"] as const;
        for (let i = 0; i < 100; i++) {
            expect(items).toContain(rng.pick(items));
        }
    });
});
