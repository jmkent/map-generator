// Generation orchestrator: seed + params -> MapModel. Each stage draws from its
// own named RNG stream so stages stay independent (see PLAN.md §5). PURE.

import type { MapModel, VillageParams } from "./types";
import { createRng } from "./rng";
import { generateBoundary } from "./stages/boundary";
import { generateRoads } from "./stages/roads";
import { generateParcels } from "./stages/parcels";
import { generateBuildings } from "./stages/buildings";
import { bounds as polygonBounds } from "./geometry/polygon";

export const DEFAULT_PARAMS: VillageParams = {
    radius: 125,
    boundaryPoints: 36,
    boundaryIrregularity: 0.18,
    primaryCount: 3,
    roadSamples: 14,
    roadJitter: 0.08,
    roadInset: 0.1,
    secondaryCount: 5,
    laneCount: 2,
    primaryRoadWidth: 3.5,
    secondaryRoadWidth: 2.5,
    laneRoadWidth: 1.8,
    lotWidth: 9,
    lotDepth: 11,
    lotSetback: 1.5,
    lotWidthJitter: 0.25,
    buildingYard: 1.5,
    buildingMinHeight: 3,
    buildingMaxHeight: 6,
    buildingDensity: 0.85,
};

export function generateVillage(seed: string, params: Partial<VillageParams> = {}): MapModel {
    const p: VillageParams = { ...DEFAULT_PARAMS, ...params };
    const rng = createRng(seed);

    const boundary = generateBoundary(rng.stream("boundary"), {
        radius: p.radius,
        points: p.boundaryPoints,
        irregularity: p.boundaryIrregularity,
    });

    const roads = generateRoads(rng.stream("roads"), {
        boundary,
        radius: p.radius,
        primaryCount: p.primaryCount,
        samples: p.roadSamples,
        jitter: p.roadJitter * p.radius,
        inset: p.roadInset * p.radius,
        secondaryCount: p.secondaryCount,
        laneCount: p.laneCount,
        primaryWidth: p.primaryRoadWidth,
        secondaryWidth: p.secondaryRoadWidth,
        laneWidth: p.laneRoadWidth,
        frontage: p.lotWidth,
    });

    const parcels = generateParcels(rng.stream("parcels"), {
        boundary,
        roads,
        radius: p.radius,
        lotWidth: p.lotWidth,
        lotDepth: p.lotDepth,
        lotSetback: p.lotSetback,
        lotWidthJitter: p.lotWidthJitter,
        density: p.buildingDensity,
    });

    const buildings = generateBuildings(rng.stream("buildings"), parcels, {
        yard: p.buildingYard,
        minHeight: p.buildingMinHeight,
        maxHeight: p.buildingMaxHeight,
    });

    return {
        seed,
        params: p,
        bounds: polygonBounds(boundary),
        boundary,
        roads,
        parcels,
        buildings,
    };
}
