// Generation orchestrator: seed + params -> MapModel. Each stage draws from its
// own named RNG stream so stages stay independent (see PLAN.md §5). PURE.

import type { MapModel, VillageParams } from "./types";
import { createRng } from "./rng";
import { generateBoundary } from "./stages/boundary";
import { generateRoads } from "./stages/roads";
import { generateParcels } from "./stages/parcels";
import { generateBuildings } from "./stages/buildings";
import { generateLayout } from "./stages/layout";
import { generateApproaches } from "./stages/approaches";
import { generateRiver, generateStandingWater, integrateRiverCrossings } from "./stages/water";
import { bounds as polygonBounds, expandBounds } from "./geometry/polygon";

export const DEFAULT_PARAMS: VillageParams = {
    radius: 125,
    boundaryPoints: 36,
    boundaryIrregularity: 0.18,
    settlementProfile: "auto",
    countrysideMargin: 0.32,
    approachRoadMin: 2,
    approachRoadMax: 4,
    riverChance: 0.4,
    riverWidth: 9,
    standingWaterKind: "auto",
    primaryRoadTarget: 3,
    roadSamples: 14,
    roadJitter: 0.08,
    roadInset: 0.1,
    secondaryRoadBudget: 5,
    laneRoadBudget: 2,
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

    const bounds = polygonBounds(boundary);
    const mapBounds = expandBounds(bounds, p.radius * p.countrysideMargin);
    const waterRng = rng.stream("water");
    const river = waterRng.chance(p.riverChance)
        ? generateRiver(waterRng, { boundary, mapBounds, radius: p.radius, width: p.riverWidth })
        : undefined;
    const settlement = generateLayout(rng.stream("layout"), {
        boundary,
        radius: p.radius,
        profile: p.settlementProfile,
    });

    const internalRoads = generateRoads(rng.stream("roads"), {
        boundary,
        radius: p.radius,
        primaryTarget: p.primaryRoadTarget,
        samples: p.roadSamples,
        jitter: p.roadJitter * p.radius,
        inset: p.roadInset * p.radius,
        secondaryBudget: p.secondaryRoadBudget,
        laneBudget: p.laneRoadBudget,
        primaryWidth: p.primaryRoadWidth,
        secondaryWidth: p.secondaryRoadWidth,
        laneWidth: p.laneRoadWidth,
        frontage: p.lotWidth,
        layout: settlement,
    });
    const approachedRoads = generateApproaches(rng.stream("approaches"), {
        boundary,
        mapBounds,
        roads: internalRoads,
        minCount: p.approachRoadMin,
        maxCount: p.approachRoadMax,
        width: p.primaryRoadWidth,
    });
    const roads = river ? integrateRiverCrossings(approachedRoads, river) : approachedRoads;
    const standingWater = generateStandingWater(rng.stream("standing-water"), {
        boundary,
        mapBounds,
        roads,
        river,
        radius: p.radius,
        kind: p.standingWaterKind,
    });
    const water = river ? [river, standingWater] : [standingWater];

    const parcels = generateParcels(rng.stream("parcels"), {
        boundary,
        roads,
        radius: p.radius,
        lotWidth: p.lotWidth,
        lotDepth: p.lotDepth,
        lotSetback: p.lotSetback,
        lotWidthJitter: p.lotWidthJitter,
        density: p.buildingDensity,
        layout: settlement,
        water,
    });

    const buildings = generateBuildings(rng.stream("buildings"), parcels, {
        yard: p.buildingYard,
        minHeight: p.buildingMinHeight,
        maxHeight: p.buildingMaxHeight,
    });

    return {
        seed,
        params: p,
        bounds,
        mapBounds,
        boundary,
        settlement,
        civicSpaces: settlement.civicSpaces,
        water,
        roads,
        parcels,
        buildings,
    };
}
