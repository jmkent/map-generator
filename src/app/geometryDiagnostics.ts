// Human-readable, model-derived diagnostics for the on-canvas HUD. PURE.

import type { MapModel, RoadClass, WaterBody } from "../gen/types";

const ROAD_CLASSES: RoadClass[] = ["primary", "secondary", "lane", "track", "approach"];

/** Summarize the concrete geometry produced for one seed. */
export function geometryDiagnostics(model: MapModel): string[] {
    const roadCounts = ROAD_CLASSES
        .map((kind) => ({ kind, count: model.roads.edges.filter((edge) => edge.kind === kind).length }))
        .filter(({ count }) => count > 0)
        .map(({ kind, count }) => `${kind} ${count}`)
        .join(", ");
    const river = model.water.find((body): body is Extract<WaterBody, { kind: "river" }> => body.kind === "river");
    const standingWater = model.water.filter((body) => body.kind !== "river");
    const water = river
        ? `river: ${river.path.length - 1} spans, ${river.width} units${standingWater.length ? `; ${waterNames(standingWater)}` : ""}`
        : standingWater.length ? `river: none; ${waterNames(standingWater)}` : "river: none; standing water: none";
    const bridges = model.roads.nodes.filter((node) => node.crossing === "bridge").length;

    return [
        `terrain: ${model.terrain.profile}; ${buildablePercent(model.terrain.samples)}% buildable`,
        `site: ${model.site.rationale}; ${Math.round(model.site.suitability * 100)}% suitability`,
        `layout: ${model.settlement.profile}`,
        `roads: ${model.roads.nodes.length} nodes, ${model.roads.edges.length} segments (${roadCounts})`,
        water,
        `bridges: ${bridges}`,
        `civic spaces: ${model.civicSpaces.length}`,
        `parcels: ${model.parcels.length}; buildings: ${model.buildings.length}`,
    ];
}

function buildablePercent(samples: Array<{ buildable: boolean }>): number {
    return Math.round(samples.filter((sample) => sample.buildable).length / samples.length * 100);
}

function waterNames(water: Array<Exclude<WaterBody, { kind: "river" }>>): string {
    const counts = new Map<string, number>();
    for (const body of water) counts.set(body.kind, (counts.get(body.kind) ?? 0) + 1);
    return `standing water: ${[...counts].map(([kind, count]) => `${kind} ${count}`).join(", ")}`;
}
