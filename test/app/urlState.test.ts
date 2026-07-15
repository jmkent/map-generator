import { describe, expect, it } from "vitest";

import { parseSeed, randomSeed, serializeState } from "../../src/app/urlState";

describe("parseSeed", () => {
    const cases: Array<{ name: string; search: string; expected: string | null }> = [
        { name: "present", search: "?seed=abc123", expected: "abc123" },
        { name: "no leading question mark", search: "seed=abc123", expected: "abc123" },
        { name: "absent", search: "", expected: null },
        { name: "other params only", search: "?foo=1", expected: null },
        { name: "empty value", search: "?seed=", expected: null },
        { name: "whitespace value", search: "?seed=%20%20", expected: null },
        { name: "trims surrounding space", search: "?seed=%20abc%20", expected: "abc" },
        { name: "first of duplicates", search: "?seed=a&seed=b", expected: "a" },
        { name: "url-encoded", search: "?seed=a%20b", expected: "a b" },
    ];

    for (const c of cases) {
        it(`handles ${c.name}`, () => {
            expect(parseSeed(c.search)).toBe(c.expected);
        });
    }
});

describe("serializeState / parseSeed round-trip", () => {
    for (const seed of ["village", "abc123", "a b", "weird&=?#chars", "Ünïçödé"]) {
        it(`round-trips ${JSON.stringify(seed)}`, () => {
            expect(parseSeed(serializeState({ seed }))).toBe(seed);
        });
    }
});

describe("randomSeed", () => {
    it("is deterministic given the same stubbed sequence", () => {
        const seq = [0, 0.5, 0.99, 0.25, 0.75, 0.1, 0.9, 0.42];
        const makeRand = () => {
            let i = 0;
            return () => seq[i++ % seq.length];
        };
        expect(randomSeed(makeRand())).toBe(randomSeed(makeRand()));
    });

    it("produces the requested length from the alphabet", () => {
        const seed = randomSeed(() => 0.5, 12);
        expect(seed).toHaveLength(12);
        expect(seed).toMatch(/^[a-z0-9]+$/);
    });

    it("stays in range when rand returns values near 1", () => {
        const seed = randomSeed(() => 0.999999, 6);
        expect(seed).toMatch(/^[a-z0-9]{6}$/);
    });
});
