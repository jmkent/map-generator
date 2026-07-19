// Off-map approach roads. PURE.
//
// The village graph is built inside its boundary first. This stage then extends
// selected primary endpoints along their outgoing tangent to the countryside
// edge, and re-planarizes the combined segment set.

import type { Bounds, Polygon, RoadNetwork, TerrainModel, Vec2 } from "../types";
import type { Rng } from "../rng";
import { intersectRayPolygon } from "../geometry/polygon";
import { planarize, type SegmentInput } from "../geometry/graph";
import { terrainSampleAt } from "./terrain";
import { normalize, sub } from "../geometry/vec2";

export interface ApproachParams {
    boundary: Polygon;
    mapBounds: Bounds;
    roads: RoadNetwork;
    minCount: number;
    maxCount: number;
    width: number;
    /** Height field; approaches never run out into the sea. */
    terrain?: TerrainModel;
}

interface Candidate {
    endpoint: Vec2;
    direction: Vec2;
    outer: Vec2;
    angle: number;
}

/** Continue a spread selection of primary endpoints to the rectangular map edge. */
export function generateApproaches(rng: Rng, params: ApproachParams): RoadNetwork {
    const candidates = primaryEndpointCandidates(params);
    if (candidates.length === 0) return params.roads;

    const lo = Math.max(0, Math.min(params.minCount, params.maxCount));
    const hi = Math.max(lo, params.maxCount);
    const count = Math.min(candidates.length, rng.int(lo, hi));
    const selected = spreadCandidates(rng, candidates, count);
    if (selected.length === 0) return params.roads;

    const positions = new Map(params.roads.nodes.map((node) => [node.id, node.pos]));
    const segments: SegmentInput[] = params.roads.edges.map((edge) => ({
        a: positions.get(edge.a)!,
        b: positions.get(edge.b)!,
        kind: edge.kind,
        width: edge.width,
    }));
    for (const approach of selected) {
        segments.push({ a: approach.endpoint, b: approach.outer, kind: "approach", width: params.width });
    }
    return planarize(segments);
}

function primaryEndpointCandidates(params: ApproachParams): Candidate[] {
    const positions = new Map(params.roads.nodes.map((node) => [node.id, node.pos]));
    const adjacent = new Map<number, Array<{ to: number; primary: boolean }>>();
    for (const node of params.roads.nodes) adjacent.set(node.id, []);
    for (const edge of params.roads.edges) {
        adjacent.get(edge.a)!.push({ to: edge.b, primary: edge.kind === "primary" });
        adjacent.get(edge.b)!.push({ to: edge.a, primary: edge.kind === "primary" });
    }

    const candidates: Candidate[] = [];
    for (const node of params.roads.nodes) {
        const links = adjacent.get(node.id)!;
        if (links.length !== 1 || !links[0].primary) continue;
        const endpoint = node.pos;
        const direction = normalize(sub(endpoint, positions.get(links[0].to)!));
        if (direction.x === 0 && direction.y === 0) continue;
        const boundaryHit = intersectRayPolygon(params.boundary, endpoint, direction);
        const outer = rayToMapBounds(endpoint, direction, params.mapBounds);
        if (!boundaryHit || !outer || boundaryHit.distance >= distanceAlongRay(endpoint, outer, direction)) continue;
        // Don't run an entrance out into the water; keep approaches on dry land.
        if (params.terrain && crossesSea(params.terrain, endpoint, outer)) continue;
        candidates.push({ endpoint, direction, outer, angle: Math.atan2(direction.y, direction.x) });
    }
    return candidates;
}

/** Pick candidates that maximize angular separation after a seeded first entrance. */
function spreadCandidates(rng: Rng, candidates: Candidate[], count: number): Candidate[] {
    if (count <= 0) return [];
    const remaining = [...candidates];
    const selected = [remaining.splice(rng.int(0, remaining.length - 1), 1)[0]];
    while (selected.length < count && remaining.length > 0) {
        let bestIndex = 0;
        let bestDistance = -Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const separation = Math.min(...selected.map((other) => angularDistance(remaining[i].angle, other.angle)));
            if (separation > bestDistance) {
                bestDistance = separation;
                bestIndex = i;
            }
        }
        selected.push(remaining.splice(bestIndex, 1)[0]);
    }
    return selected;
}

/** Sample the segment a->b; true if any point falls on non-land terrain (the sea). */
function crossesSea(terrain: TerrainModel, a: Vec2, b: Vec2): boolean {
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (!terrainSampleAt(terrain, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }).land) return true;
    }
    return false;
}

function rayToMapBounds(origin: Vec2, direction: Vec2, bounds: Bounds): Vec2 | null {
    const hits: Array<{ t: number; point: Vec2 }> = [];
    if (Math.abs(direction.x) > 1e-9) {
        for (const x of [bounds.minX, bounds.maxX]) {
            const t = (x - origin.x) / direction.x;
            const y = origin.y + direction.y * t;
            if (t > 1e-9 && y >= bounds.minY - 1e-9 && y <= bounds.maxY + 1e-9) hits.push({ t, point: { x, y } });
        }
    }
    if (Math.abs(direction.y) > 1e-9) {
        for (const y of [bounds.minY, bounds.maxY]) {
            const t = (y - origin.y) / direction.y;
            const x = origin.x + direction.x * t;
            if (t > 1e-9 && x >= bounds.minX - 1e-9 && x <= bounds.maxX + 1e-9) hits.push({ t, point: { x, y } });
        }
    }
    hits.sort((a, b) => a.t - b.t);
    return hits[0]?.point ?? null;
}

function distanceAlongRay(origin: Vec2, point: Vec2, direction: Vec2): number {
    return Math.abs(direction.x) > Math.abs(direction.y) ? (point.x - origin.x) / direction.x : (point.y - origin.y) / direction.y;
}

function angularDistance(a: number, b: number): number {
    const diff = Math.abs(a - b) % (Math.PI * 2);
    return Math.min(diff, Math.PI * 2 - diff);
}
