// Scalar math shared across generation. PURE — no Vec2, no randomness.

/** Constrain a value to the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
