// Seedable PRNG with named streams. PURE (no Math.random / Date.now) so
// generation is fully deterministic and reproducible from a seed (see PLAN.md §5).
//
// Named streams are the key idea: `rng.stream(name)` derives an independent
// generator from (masterSeed, name) alone — never from consumption state — so
// adding or reordering draws in one stage cannot shift another stage's sequence.
// That keeps golden-test churn local to the stage you actually changed.

/** A deterministic random source. */
export interface Rng {
    /** The 32-bit numeric seed backing this generator. */
    readonly seed: number;
    /** Next float in [0, 1). */
    next(): number;
    /** Float in [min, max). */
    float(min: number, max: number): number;
    /** Integer in [min, max] (inclusive both ends). */
    int(min: number, max: number): number;
    /** True with probability p. */
    chance(p: number): boolean;
    /** Uniformly pick one element (undefined for an empty array). */
    pick<T>(items: readonly T[]): T;
    /** Sample from a normal distribution (Box–Muller). */
    gaussian(mean?: number, stddev?: number): number;
    /** Derive an independent sub-stream keyed by `name`. */
    stream(name: string): Rng;
}

/** Hash a string to a 32-bit unsigned integer (xmur3). */
export function hashSeed(str: string): number {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
}

/** mulberry32: a small, fast 32-bit PRNG. Returns floats in [0, 1). */
function mulberry32(a: number): () => number {
    let state = a >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Derive a sub-stream seed from a parent seed and a stream name. */
function deriveSeed(seed: number, name: string): number {
    return hashSeed(`${seed.toString(36)}␟${name}`);
}

function makeRng(seed: number): Rng {
    const rand = mulberry32(seed);
    return {
        seed,
        next: rand,
        float: (min, max) => min + rand() * (max - min),
        int: (min, max) => min + Math.floor(rand() * (max - min + 1)),
        chance: (p) => rand() < p,
        pick: (items) => items[Math.floor(rand() * items.length)],
        gaussian: (mean = 0, stddev = 1) => {
            let u = 0;
            let v = 0;
            while (u === 0) u = rand();
            while (v === 0) v = rand();
            return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        },
        stream: (name) => makeRng(deriveSeed(seed, name)),
    };
}

/** Create a root RNG from a string or numeric seed. */
export function createRng(seed: string | number): Rng {
    const numeric = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
    return makeRng(numeric);
}
