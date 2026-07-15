// Generation orchestrator: seed + params -> MapModel. Each stage draws from its
// own named RNG stream so stages stay independent (see PLAN.md §5). PURE.

import type { MapModel, VillageParams } from "./types";
import { createRng } from "./rng";
import { generateBoundary } from "./stages/boundary";
import { bounds as polygonBounds } from "./geometry/polygon";

export const DEFAULT_PARAMS: VillageParams = {
    radius: 90,
    boundaryPoints: 36,
    boundaryIrregularity: 0.18,
};

export function generateVillage(seed: string, params: Partial<VillageParams> = {}): MapModel {
    const p: VillageParams = { ...DEFAULT_PARAMS, ...params };
    const rng = createRng(seed);

    const boundary = generateBoundary(rng.stream("boundary"), {
        radius: p.radius,
        points: p.boundaryPoints,
        irregularity: p.boundaryIrregularity,
    });

    return {
        seed,
        params: p,
        bounds: polygonBounds(boundary),
        boundary,
    };
}
