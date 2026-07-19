// Structural river generation and road-crossing integration. PURE.

import type { Bounds, Polygon, River, RoadEdge, RoadNetwork, RoadNode, StandingWater, TerrainModel, Vec2, VillageParams } from "../types";
import type { Rng } from "../rng";
import { catmullRom } from "../geometry/catmullRom";
import { area, centroid, contains, ensureCCW, signedArea } from "../geometry/polygon";
import { isoContours, type ContourGrid } from "../geometry/contour";
import { add, lerp, normalize, perp, scale, sub } from "../geometry/vec2";

export interface RiverParams {
    boundary: Polygon;
    mapBounds: Bounds;
    radius: number;
    width: number;
    /** Height field used to orient flow (source high, mouth low) and vary width. */
    terrain?: TerrainModel;
}

export interface StandingWaterParams {
    boundary: Polygon;
    mapBounds: Bounds;
    roads: RoadNetwork;
    river?: River;
    radius: number;
    kind: "auto" | StandingWater["kind"];
}

export interface RiverResolveParams {
    terrain: TerrainModel;
    boundary: Polygon;
    radius: number;
    riverChance: number;
    riverWidth: number;
}

export interface StandingWaterResolveParams {
    terrain: TerrainModel;
    boundary: Polygon;
    radius: number;
    standingWaterKind: VillageParams["standingWaterKind"];
    roads: RoadNetwork;
    river?: River;
}

/**
 * Resolve the river from the landform *before* roads, so the road stage can choose
 * a deliberate crossing (M12b). Standing water is resolved separately afterwards.
 * Both draw from the same hydrology stream in this order, so the sequence is
 * unchanged from resolving them together.
 */
export function resolveRiver(rng: Rng, params: RiverResolveParams): River | undefined {
    const riverChance = terrainRiverChance(params.terrain.profile, params.riverChance);
    return rng.chance(riverChance)
        ? generateRiver(rng, { boundary: params.boundary, mapBounds: params.terrain.bounds, radius: params.radius, width: params.riverWidth, terrain: params.terrain })
        : undefined;
}

/** Resolve standing water after roads, so closed bodies can avoid the road graph. */
export function resolveStandingWater(rng: Rng, params: StandingWaterResolveParams): StandingWater {
    const kind = params.standingWaterKind === "auto" ? terrainWaterKind(params.terrain.profile) : params.standingWaterKind;
    // A coast traces its shoreline from the height field, so coves, peninsulas, and
    // irregular coasts follow the actual land/sea boundary. Falls back to the
    // heuristic reserve when the terrain has no traceable single-region sea.
    if (kind === "coast") {
        const sea = terrainSea(params.terrain);
        if (sea) return { kind, polygon: sea };
    }
    return generateStandingWater(rng, {
        boundary: params.boundary,
        mapBounds: params.terrain.bounds,
        roads: params.roads,
        river: params.river,
        radius: params.radius,
        kind,
    });
}

/**
 * Trace the sea (height below sea level) as a single simple polygon following the
 * true shoreline. Returns null when the sea is absent, negligible, or a ring around
 * an island (which needs a hole and is left to the heuristic fallback).
 */
export function terrainSea(terrain: TerrainModel): Polygon | null {
    const { bounds, resolution } = terrain;
    const grid: ContourGrid = {
        values: terrain.samples.map((sample) => sample.height),
        cols: resolution,
        rows: resolution,
        toWorld: (col, row) => ({
            x: bounds.minX + (bounds.maxX - bounds.minX) * col / (resolution - 1),
            y: bounds.minY + (bounds.maxY - bounds.minY) * row / (resolution - 1),
        }),
    };
    const loops = isoContours(grid, terrain.seaLevel);
    const mapArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    const seaLoops = loops.filter((loop) => signedArea(loop) > 0).sort((a, b) => area(b) - area(a));
    const sea = seaLoops[0];
    if (!sea || area(sea) < mapArea * 0.02) return null;
    // A land island inside the sea makes it a ring we cannot express as one simple
    // polygon; defer those to the heuristic coast.
    const holes = loops.filter((loop) => signedArea(loop) < 0);
    if (holes.some((loop) => area(loop) > mapArea * 0.01 && contains(sea, centroid(loop)))) return null;
    return dedupePolygon(sea.map((point) => clampToBounds(point, bounds)));
}

/** Drop consecutive duplicate vertices (clamping to bounds can coincide points). */
function dedupePolygon(poly: Polygon): Polygon {
    const out: Polygon = [];
    for (const p of poly) {
        const last = out[out.length - 1];
        if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) out.push(p);
    }
    while (out.length >= 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-6) out.pop();
    return out;
}

function terrainRiverChance(profile: TerrainModel["profile"], configured: number): number {
    if (configured === 0 || configured === 1) return configured;
    if (profile === "river-valley") return Math.max(configured, 0.9);
    if (profile === "ridge" || profile === "hillside" || profile === "island") return Math.min(configured, 0.15);
    return configured;
}

function terrainWaterKind(profile: TerrainModel["profile"]): VillageParams["standingWaterKind"] {
    if (profile === "lakeshore") return "lake";
    if (profile === "coast" || profile === "cove" || profile === "peninsula" || profile === "island") return "coast";
    return "pond";
}

/** Create a seeded, gently meandering channel from one map edge to its opposite. */
export function generateRiver(rng: Rng, params: RiverParams): River {
    const { boundary, mapBounds, radius, width } = params;
    const horizontal = rng.chance(0.5);
    const span = horizontal ? mapBounds.maxX - mapBounds.minX : mapBounds.maxY - mapBounds.minY;
    const crossMin = horizontal ? mapBounds.minY : mapBounds.minX;
    const crossMax = horizontal ? mapBounds.maxY : mapBounds.maxX;
    const center = centroidLike(boundary);
    const centerCross = horizontal ? center.y : center.x;
    const endpointOffset = Math.min(radius * 0.16, (crossMax - crossMin) * 0.14);
    const startCross = clamp(centerCross + rng.float(-endpointOffset, endpointOffset), crossMin, crossMax);
    const endCross = clamp(centerCross + rng.float(-endpointOffset, endpointOffset), crossMin, crossMax);
    const meander = Math.min(radius * 0.24, (crossMax - crossMin) * 0.17);
    const controls: Vec2[] = horizontal
        ? [
            { x: mapBounds.minX, y: startCross },
            { x: mapBounds.minX + span * 0.28, y: clamp(center.y + rng.float(-meander, meander), crossMin, crossMax) },
            center,
            { x: mapBounds.minX + span * 0.72, y: clamp(center.y + rng.float(-meander, meander), crossMin, crossMax) },
            { x: mapBounds.maxX, y: endCross },
        ]
        : [
            { x: startCross, y: mapBounds.minY },
            { x: clamp(center.x + rng.float(-meander, meander), crossMin, crossMax), y: mapBounds.minY + span * 0.28 },
            center,
            { x: clamp(center.x + rng.float(-meander, meander), crossMin, crossMax), y: mapBounds.minY + span * 0.72 },
            { x: endCross, y: mapBounds.maxY },
        ];
    const path = catmullRom(controls, 10);
    const { leftBank, rightBank } = riverBanks(rng, path, width, mapBounds, params.terrain);
    return { kind: "river", path, leftBank, rightBank, width };
}

/** Generate one closed body in open land, or a coastal reserve against the map edge. */
export function generateStandingWater(rng: Rng, params: StandingWaterParams): StandingWater {
    const kind = params.kind === "auto" ? rng.pick(["pond", "lake", "coast"] as const) : params.kind;
    const river = params.river;
    if (kind === "coast") return coast(rng, params);
    const size = kind === "pond" ? params.radius * 0.09 : params.radius * 0.19;
    const roadPositions = new Map(params.roads.nodes.map((node) => [node.id, node.pos]));
    for (let attempt = 0; attempt < 40; attempt++) {
        const center = randomPointInBoundary(rng, params.boundary, params.radius);
        const polygon = organicBody(rng, center, size, kind === "pond" ? 10 : 14);
        if (!polygon.every((point) => contains(params.boundary, point))) continue;
        if (river && polygon.some((point) => distanceToRiver(point, river) < river.width / 2 + size * 0.3)) continue;
        if (params.roads.edges.some((edge) => distancePointToSegment(center, roadPositions.get(edge.a)!, roadPositions.get(edge.b)!) < size + edge.width)) continue;
        return { kind, polygon };
    }
    // A small centered fallback keeps the model populated without violating the
    // hard land boundary when an unusually dense road graph leaves few slots.
    return { kind, polygon: organicBody(rng, centroidLike(params.boundary), size * 0.55, 10) };
}

/** Split road edges at river intersections and flag the inserted bridge nodes. */
export function integrateRiverCrossings(roads: RoadNetwork, river: River): RoadNetwork {
    const positions = new Map(roads.nodes.map((node) => [node.id, node.pos]));
    const nodes: RoadNode[] = roads.nodes.map((node) => ({ ...node }));
    const nodeId = (pos: Vec2, crossing = false): number => {
        for (const node of nodes) {
            if (Math.hypot(node.pos.x - pos.x, node.pos.y - pos.y) < 1e-5) {
                if (crossing) node.crossing = "bridge";
                return node.id;
            }
        }
        const id = nodes.length;
        nodes.push({ id, pos, ...(crossing ? { crossing: "bridge" as const } : {}) });
        return id;
    };
    const edges: RoadEdge[] = [];
    for (const edge of roads.edges) {
        const a = positions.get(edge.a)!;
        const b = positions.get(edge.b)!;
        const splits = [{ t: 0, point: a, crossing: false }, { t: 1, point: b, crossing: false }];
        for (let i = 1; i < river.path.length; i++) {
            const hit = segmentIntersection(a, b, river.path[i - 1], river.path[i]);
            if (!hit) continue;
            // A crossing at a road vertex (a deliberate ford anchored on the river
            // centerline) marks that endpoint; an interior crossing adds a split.
            if (hit.t <= 1e-6) splits[0].crossing = true;
            else if (hit.t >= 1 - 1e-6) splits[1].crossing = true;
            else splits.push({ t: hit.t, point: hit.point, crossing: true });
        }
        splits.sort((left, right) => left.t - right.t);
        const unique = splits.filter((split, index) => index === 0 || split.t - splits[index - 1].t > 1e-6);
        for (let i = 1; i < unique.length; i++) {
            const start = nodeId(unique[i - 1].point, unique[i - 1].crossing);
            const end = nodeId(unique[i].point, unique[i].crossing);
            if (start !== end) {
                const crossing = unique[i - 1].crossing || unique[i].crossing ? "bridge" as const : undefined;
                edges.push({ ...edge, a: start, b: end, ...(crossing ? { crossing } : {}) });
            }
        }
    }
    return { nodes, edges };
}

/** Distance from a point to the river centerline, used for bank-density bias. */
export function distanceToRiver(point: Vec2, river: River): number {
    let best = Infinity;
    for (let i = 1; i < river.path.length; i++) best = Math.min(best, pointSegmentDistance(point, river.path[i - 1], river.path[i]));
    return best;
}

/** Shortest shoreline distance for either a closed water body or flowing river. */
export function distanceToWater(point: Vec2, water: River | StandingWater): number {
    if (water.kind === "river") return Math.max(0, distanceToRiver(point, water) - water.width / 2);
    let best = Infinity;
    for (let i = 0; i < water.polygon.length; i++) best = Math.min(best, distancePointToSegment(point, water.polygon[i], water.polygon[(i + 1) % water.polygon.length]));
    return best;
}

function pointSegmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
    const ab = sub(b, a);
    const lengthSq = ab.x * ab.x + ab.y * ab.y;
    const t = lengthSq === 0 ? 0 : clamp(((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSq, 0, 1);
    return Math.hypot(point.x - (a.x + ab.x * t), point.y - (a.y + ab.y * t));
}

function distancePointToSegment(point: Vec2, a: Vec2, b: Vec2): number {
    return pointSegmentDistance(point, a, b);
}

function organicBody(rng: Rng, center: Vec2, radius: number, points: number): Polygon {
    const polygon: Vec2[] = [];
    for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const r = radius * rng.float(0.75, 1.15);
        polygon.push({ x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r });
    }
    return ensureCCW(polygon);
}

function randomPointInBoundary(rng: Rng, boundary: Polygon, radius: number): Vec2 {
    const center = centroidLike(boundary);
    for (let attempt = 0; attempt < 24; attempt++) {
        const point = { x: center.x + rng.float(-radius * 0.6, radius * 0.6), y: center.y + rng.float(-radius * 0.6, radius * 0.6) };
        if (contains(boundary, point)) return point;
    }
    return center;
}

function centroidLike(poly: Polygon): Vec2 {
    return poly.reduce((sum, point) => ({ x: sum.x + point.x / poly.length, y: sum.y + point.y / poly.length }), { x: 0, y: 0 });
}

function coast(rng: Rng, params: StandingWaterParams): StandingWater {
    const { minX, minY, maxX, maxY } = params.mapBounds;
    const sides = ["left", "right", "bottom", "top"] as const;
    const depth = params.radius * 0.18;
    const offset = rng.int(0, sides.length - 1);
    const ordered = sides.map((_, index) => sides[(index + offset) % sides.length]);
    const positions = new Map(params.roads.nodes.map((node) => [node.id, node.pos]));
    for (const side of ordered) {
        const polygon = coastPolygon(rng, side, minX, minY, maxX, maxY, depth);
        if (!params.roads.edges.some((edge) => segmentTouchesPolygon(positions.get(edge.a)!, positions.get(edge.b)!, polygon))) {
            return { kind: "coast", polygon };
        }
    }
    // An unusually crowded map still gets a coastal reserve, but shrink it to
    // the outermost strip so it does not swallow an entrance road.
    return { kind: "coast", polygon: coastPolygon(rng, ordered[0], minX, minY, maxX, maxY, params.radius * 0.04) };
}

function coastPolygon(rng: Rng, side: "left" | "right" | "bottom" | "top", minX: number, minY: number, maxX: number, maxY: number, depth: number): Polygon {
    const steps = 12;
    const jitter = depth * 0.28;
    const shore = Array.from({ length: steps + 1 }, (_, index) => {
        const t = index / steps;
        const noise = index === 0 || index === steps ? 0 : rng.float(-jitter, jitter);
        if (side === "left") return { x: minX + depth + noise, y: minY + (maxY - minY) * t };
        if (side === "right") return { x: maxX - depth - noise, y: minY + (maxY - minY) * t };
        if (side === "bottom") return { x: minX + (maxX - minX) * t, y: minY + depth + noise };
        return { x: minX + (maxX - minX) * t, y: maxY - depth - noise };
    });
    const polygon = side === "left" ? [{ x: minX, y: minY }, ...shore, { x: minX, y: maxY }]
        : side === "right" ? [{ x: maxX, y: minY }, { x: maxX, y: maxY }, ...shore.reverse()]
        : side === "bottom" ? [{ x: minX, y: minY }, { x: maxX, y: minY }, ...shore.reverse()]
        : [...shore, { x: maxX, y: maxY }, { x: minX, y: maxY }];
    return ensureCCW(polygon);
}

function riverBanks(rng: Rng, path: Vec2[], width: number, bounds: Bounds, terrain?: TerrainModel): { leftBank: Vec2[]; rightBank: Vec2[] } {
    const leftBank: Vec2[] = [];
    const rightBank: Vec2[] = [];
    // Orient the channel so the mouth is the lower (downstream) end. Rivers widen
    // markedly from source to mouth; the local noise then wanders that envelope.
    const startHigh = terrain ? sampleHeight(terrain, path[0]) : 0;
    const endHigh = terrain ? sampleHeight(terrain, path[path.length - 1]) : 0;
    const mouthAtEnd = endHigh <= startHigh;
    let previousNoise = rng.float(-0.16, 0.16);
    for (let i = 0; i < path.length; i++) {
        const before = path[Math.max(0, i - 1)];
        const after = path[Math.min(path.length - 1, i + 1)];
        const normal = normalize(perp(sub(after, before)));
        const noise = i === 0 || i === path.length - 1 ? 0 : previousNoise * 0.6 + rng.float(-0.2, 0.2);
        previousNoise = noise;
        // Fraction from source (0) to mouth (1) along the path.
        const along = path.length > 1 ? i / (path.length - 1) : 0;
        const downstream = mouthAtEnd ? along : 1 - along;
        const taper = 0.4 + downstream * downstream * 1.3; // ~0.4x at source, ~1.7x at mouth
        const half = width * taper * (0.5 + noise);
        leftBank.push(clampToBounds(add(path[i], scale(normal, half)), bounds));
        rightBank.push(clampToBounds(sub(path[i], scale(normal, half)), bounds));
    }
    return { leftBank, rightBank };
}

/** Nearest height-field sample to a world point (avoids a terrain->water import cycle). */
function sampleHeight(terrain: TerrainModel, point: Vec2): number {
    const { bounds, resolution } = terrain;
    const tx = clamp(Math.round((point.x - bounds.minX) / (bounds.maxX - bounds.minX) * (resolution - 1)), 0, resolution - 1);
    const ty = clamp(Math.round((point.y - bounds.minY) / (bounds.maxY - bounds.minY) * (resolution - 1)), 0, resolution - 1);
    return terrain.samples[ty * resolution + tx].height;
}

function clampToBounds(point: Vec2, bounds: Bounds): Vec2 {
    return { x: clamp(point.x, bounds.minX, bounds.maxX), y: clamp(point.y, bounds.minY, bounds.maxY) };
}

function segmentTouchesPolygon(a: Vec2, b: Vec2, polygon: Polygon): boolean {
    if (contains(polygon, a) || contains(polygon, b)) return true;
    for (let i = 0; i < polygon.length; i++) {
        if (segmentIntersection(a, b, polygon[i], polygon[(i + 1) % polygon.length])) return true;
    }
    return false;
}

function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; point: Vec2 } | null {
    const r = sub(b, a);
    const s = sub(d, c);
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-10) return null;
    const qx = c.x - a.x;
    const qy = c.y - a.y;
    const t = (qx * s.y - qy * s.x) / denom;
    const u = (qx * r.y - qy * r.x) / denom;
    return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? { t, point: lerp(a, b, t) } : null;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
