// Village boundary stage: an organic, closed outline generated from a seed.
//
// The radius is modulated by a small sum of random sine harmonics, producing
// smooth lobes rather than jagged noise. Because the radius stays positive, the
// result is star-shaped about the origin and therefore always a simple
// (non-self-intersecting) polygon — a property the invariant tests rely on.

import type { Polygon } from "../types";
import type { Rng } from "../rng";

export interface BoundaryParams {
    /** Mean radius, world units. */
    radius: number;
    /** Vertex count around the ring. */
    points: number;
    /** Radial variation amplitude, 0 (circle) .. <1. */
    irregularity: number;
}

/** Harmonic frequencies that shape the lobes. Low, coprime-ish counts read organic. */
const HARMONICS = [2, 3, 5];

export function generateBoundary(rng: Rng, params: BoundaryParams): Polygon {
    const { radius, points, irregularity } = params;
    const amps = HARMONICS.map(() => rng.float(0.3, 1));
    const phases = HARMONICS.map(() => rng.float(0, Math.PI * 2));
    const ampSum = amps.reduce((s, a) => s + a, 0) || 1;

    const poly: Polygon = [];
    for (let i = 0; i < points; i++) {
        const theta = (i / points) * Math.PI * 2;
        let variation = 0;
        for (let k = 0; k < HARMONICS.length; k++) {
            variation += amps[k] * Math.sin(HARMONICS[k] * theta + phases[k]);
        }
        variation /= ampSum; // normalize into [-1, 1]
        const r = radius * (1 + irregularity * variation);
        poly.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r });
    }
    return poly; // increasing theta => CCW
}
