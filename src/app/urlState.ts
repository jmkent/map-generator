// Seed & app-state <-> URL query mapping. Pure string logic (no DOM), so it is
// fully unit-testable. The App layer owns reading window.location and writing
// history; this module just parses/serializes.

export interface AppState {
    seed: string;
}

const SEED_KEY = "seed";
const SEED_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Read the seed from a URL query string (with or without a leading "?").
 * Returns null when the param is absent or blank so the caller can fall back to
 * a default or a freshly generated seed.
 */
export function parseSeed(search: string): string | null {
    const params = new URLSearchParams(search);
    const raw = params.get(SEED_KEY);
    if (raw === null) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Serialize app state to a URL query string, e.g. "?seed=village". */
export function serializeState(state: AppState): string {
    const params = new URLSearchParams();
    params.set(SEED_KEY, state.seed);
    return `?${params.toString()}`;
}

/**
 * Generate a random alphanumeric seed. `rand` defaults to Math.random; inject a
 * stub for deterministic tests. (Randomness here is UI convenience, not part of
 * the deterministic generator — hence Math.random is allowed outside gen/.)
 */
export function randomSeed(rand: () => number = Math.random, length = 8): string {
    let out = "";
    for (let i = 0; i < length; i++) {
        const idx = Math.min(SEED_ALPHABET.length - 1, Math.floor(rand() * SEED_ALPHABET.length));
        out += SEED_ALPHABET[idx];
    }
    return out;
}
