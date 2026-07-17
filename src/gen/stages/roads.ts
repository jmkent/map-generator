// Road network stage: a small hierarchy — primary through-roads, secondary
// connectors, and lane stubs — planarized into one connected graph. PURE.
//
// A gently curved trunk and a seed-varying number of offset cross streets form
// the main structure. Secondary roads grow a denser central graph by preferring
// compact loop-closing links between existing corridors. Secondary roads always
// join the graph at both ends; only lanes may be dead ends. Every addition must
// support several lots, remain well separated from other junctions, and clear
// existing corridors. The soup of segments is handed to `planarize`, which splits
// every crossing into a shared node.

import type { Polygon, River, RoadClass, RoadNetwork, SettlementLayout, TerrainModel, Vec2 } from "../types";
import type { Rng } from "../rng";
import { centroid, contains, distanceToBoundary, inset, intersectRayPolygon } from "../geometry/polygon";
import { catmullRom } from "../geometry/catmullRom";
import { planarize, type SegmentInput } from "../geometry/graph";
import { terrainSampleAt } from "./terrain";
import { distanceToRiver } from "./water";
import { add, dist, normalize, perp, scale, sub } from "../geometry/vec2";

export interface RoadParams {
    boundary: Polygon;
    radius: number;
    /** Target number of primary roads; generation varies this slightly by seed. */
    primaryTarget: number;
    samples: number;
    /** Trunk-road anchor jitter, world units. */
    jitter: number;
    /** Margin keeping roads inside the boundary, world units. */
    inset: number;
    /** Soft growth budget for secondary connectors. */
    secondaryBudget: number;
    /** Soft growth budget for lane branches. */
    laneBudget: number;
    primaryWidth: number;
    secondaryWidth: number;
    laneWidth: number;
    /** Typical lot frontage, used to keep branch roads useful and well spaced. */
    frontage: number;
    layout: SettlementLayout;
    /** Terrain substrate; roads avoid water and slopes steeper than they can climb. */
    terrain?: TerrainModel;
    /** Structural river; roads only cross it at a chosen ford (M12b). */
    river?: River;
}

const MIN_EDGE_LEN = 1e-3;
const MIN_LANE_LOTS = 2;
// Roads may climb somewhat steeper ground than a lot can sit on (buildable is
// slope < 0.22), but they never cross water or genuinely steep terrain.
const MAX_ROAD_SLOPE = 0.32;

interface Ford {
    /** Crossing point on the river centerline. */
    point: Vec2;
    /** Direction a road should take across the river here (perpendicular to it). */
    axis: Vec2;
}

interface RoadGenerationContext {
    rng: Rng;
    safeArea: Polygon;
    radius: number;
    frontage: number;
    junctionSpacing: number;
    jitter: number;
    samples: number;
    terrain?: TerrainModel;
    river?: River;
    /** Points where roads are permitted to enter the river channel. */
    fords: Vec2[];
    /** How close to a ford a channel point must be to be crossable. */
    fordRadius: number;
}

/** A point roads may occupy: dry, climbable land, and out of the river channel
 *  unless it sits at a chosen ford. */
function traversablePoint(context: RoadGenerationContext, point: Vec2): boolean {
    if (context.terrain) {
        const sample = terrainSampleAt(context.terrain, point);
        if (!sample.land || sample.slope > MAX_ROAD_SLOPE) return false;
    }
    if (context.river && inChannel(context.river, point) && !nearFord(context, point)) return false;
    return true;
}

/** True when a point lies within the flowing water of the river channel. */
function inChannel(river: River, point: Vec2): boolean {
    return distanceToRiver(point, river) <= river.width * 0.6;
}

function nearFord(context: RoadGenerationContext, point: Vec2): boolean {
    return context.fords.some((ford) => dist(ford, point) <= context.fordRadius);
}

/** Choose the gentlest, most central crossing on the river within the settlement.
 *  Returns nothing when the river does not reach the buildable area. */
function chooseFords(river: River, safeArea: Polygon, terrain: TerrainModel | undefined, radius: number): Ford[] {
    const center = centroid(safeArea);
    let best: { index: number; score: number } | undefined;
    for (let i = 0; i < river.path.length; i++) {
        const point = river.path[i];
        if (!contains(safeArea, point)) continue;
        const bankSlope = terrain
            ? Math.max(
                terrainSampleAt(terrain, river.leftBank[i]).slope,
                terrainSampleAt(terrain, river.rightBank[i]).slope,
                terrainSampleAt(terrain, point).slope,
            )
            : 0;
        const width = dist(river.leftBank[i], river.rightBank[i]);
        // Prefer gentle banks first, then a narrow channel, then a central site.
        const score = bankSlope * 3 + (width / river.width) * 0.4 + (dist(point, center) / radius) * 0.5;
        if (!best || score < best.score) best = { index: i, score };
    }
    if (!best) return [];
    const i = best.index;
    const before = river.path[Math.max(0, i - 1)];
    const after = river.path[Math.min(river.path.length - 1, i + 1)];
    const axis = normalize(perp(sub(after, before)));
    return [{ point: river.path[i], axis }];
}

function untraversableCount(context: RoadGenerationContext, points: readonly Vec2[]): number {
    if (!context.terrain && !context.river) return 0;
    let count = 0;
    for (const point of points) if (!traversablePoint(context, point)) count++;
    return count;
}

function routeTraversable(context: RoadGenerationContext, points: readonly Vec2[]): boolean {
    return untraversableCount(context, points) === 0;
}

/** A must-have through-road that prefers the terrain grain: try the intended axis,
 *  then small rotations, and keep the route that crosses the least bad ground. The
 *  route is never dropped, so the network always has a connected spine. */
function bestThroughRoad(context: RoadGenerationContext, anchor: Vec2, axis: Vec2): Vec2[] {
    let best = throughRoad(context, anchor, axis);
    let bestCost = untraversableCount(context, best);
    if (bestCost === 0) return best;
    for (const delta of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
        const points = throughRoad(context, anchor, rotate(axis, delta));
        const cost = untraversableCount(context, points);
        if (cost < bestCost) {
            best = points;
            bestCost = cost;
            if (bestCost === 0) break;
        }
    }
    return best;
}

interface Route {
    kind: RoadClass;
    points: Vec2[];
}

interface LaneCandidate {
    anchor: Vec2;
    points: Vec2[];
}

interface SecondaryConnector {
    a: Vec2;
    b: Vec2;
    points: Vec2[];
}

export function generateRoads(rng: Rng, params: RoadParams): RoadNetwork {
    if (params.layout.profile !== "haufendorf") return generateProfileRoads(rng, params);
    const { boundary, radius, primaryTarget, samples, jitter, inset: margin } = params;
    const center = centroid(boundary);
    const safeArea = inset(boundary, margin);

    // The settlement centre anchors only the trunk. Other primary roads cross it
    // at offset positions so no single node becomes the whole network's hub.
    const jittered = add(center, { x: rng.float(-jitter, jitter), y: rng.float(-jitter, jitter) });
    const trunkAnchor = contains(safeArea, jittered) ? jittered : center;

    const segments: SegmentInput[] = [];
    const pushPolyline = (pts: Vec2[], kind: SegmentInput["kind"], width: number): void => {
        for (let i = 1; i < pts.length; i++) {
            if (dist(pts[i - 1], pts[i]) >= MIN_EDGE_LEN) segments.push({ a: pts[i - 1], b: pts[i], kind, width });
        }
    };

    const primaryAnchorSpacing = Math.max(params.frontage * 2.5, radius * 0.18);
    const fords = params.river ? chooseFords(params.river, safeArea, params.terrain, radius) : [];
    const context: RoadGenerationContext = {
        rng,
        safeArea,
        radius,
        frontage: params.frontage,
        junctionSpacing: primaryAnchorSpacing,
        jitter,
        samples,
        terrain: params.terrain,
        river: params.river,
        fords: fords.map((ford) => ford.point),
        fordRadius: params.river ? params.river.width * 1.1 : 0,
    };

    // Primary through-roads. Start with a trunk, then place mostly parallel cross
    // streets at separated points on it. This is a compact, intentionally loose
    // grid: irregular enough to avoid a city-block pattern, but still legible.
    // The trunk runs with the terrain grain (the terrain-derived layout axis) so
    // the settlement follows valleys, ridgelines, and shorelines. When a river
    // bisects the village, the trunk instead crosses it at the chosen ford, so the
    // one river crossing is deliberate and every other road keeps off the water.
    const primaryRoutes: Route[] = [];
    const primaryAnchors: Vec2[] = [];
    const baseAngle = Math.atan2(params.layout.axis.y, params.layout.axis.x) + rng.float(-0.3, 0.3);
    let trunkOrigin = trunkAnchor;
    let trunkAxis: Vec2 = { x: Math.cos(baseAngle), y: Math.sin(baseAngle) };
    if (fords.length > 0) {
        trunkOrigin = fords[0].point;
        trunkAxis = fords[0].axis;
    }
    const trunk = bestThroughRoad(context, trunkOrigin, trunkAxis);
    primaryRoutes.push({ kind: "primary", points: trunk });
    pushPolyline(trunk, "primary", params.primaryWidth);

    const crossAxisBase = perp(trunkAxis);
    const primaryFloor = primaryTarget >= 3 ? 3 : 1;
    const primaryRouteCount = Math.max(primaryFloor, primaryTarget + (primaryTarget > 1 ? rng.int(-1, 1) : 0));
    for (let p = 1; p < primaryRouteCount; p++) {
        const pair = Math.ceil(p / 2);
        const side = p % 2 === 1 ? -1 : 1;
        const offset = rng.float(0.13, 0.25) + (pair - 1) * rng.float(0.08, 0.14);
        let anchor: Vec2 | null = null;
        for (let attempt = 0; attempt < 8; attempt++) {
            const frac = Math.max(0.18, Math.min(0.82, 0.5 + side * offset + rng.float(-0.07, 0.07)));
            const candidate = pointAtFraction(trunk, frac);
            if (primaryAnchors.every((other) => dist(candidate, other) >= primaryAnchorSpacing)) {
                anchor = candidate;
                break;
            }
        }
        if (!anchor) continue;
        const axis = rotate(crossAxisBase, rng.float(-0.24, 0.24));
        const poly = throughRoad(context, anchor, axis);
        // A cross street is optional: drop it rather than run it into water or up a
        // slope it cannot climb. Its anchor is only recorded once the street is kept.
        if (!routeTraversable(context, poly)) continue;
        primaryAnchors.push(anchor);
        primaryRoutes.push({ kind: "primary", points: poly });
        pushPolyline(poly, "primary", params.primaryWidth);
    }

    const routes = [...primaryRoutes];
    const junctions = primaryJunctions(trunk, primaryRoutes.slice(1).map((route) => route.points));

    // The secondary budget is deliberately soft. Each accepted road is a curved,
    // two-ended connector that closes a block or reconnects an existing secondary
    // corridor; unsuitable slots remain empty instead of becoming orphan branches.
    const secondaryBudget = Math.max(0, params.secondaryBudget + rng.int(-1, 2));
    for (let i = 0; i < secondaryBudget; i++) {
        const connector = findSecondaryConnector(context, primaryRoutes.map((route) => route.points), junctions);
        if (connector) {
            junctions.push(connector.a, connector.b);
            routes.push({ kind: "secondary", points: connector.points });
            pushPolyline(connector.points, "secondary", params.secondaryWidth);
        }
    }

    // Lanes remain logical branches, rather than being used as a fixed grid fill.
    // They host on primary or secondary routes only, never on another lane.
    const laneBudget = Math.max(0, params.laneBudget + rng.int(-1, 1));
    for (let i = 0; i < laneBudget; i++) {
        const lane = findLaneBranch(context, routes, junctions);
        if (!lane) continue;
        junctions.push(lane.anchor);
        routes.push({ kind: "lane", points: lane.points });
        pushPolyline(lane.points, "lane", params.laneWidth);
    }

    return planarize(segments);
}

/** Generate the non-clustered settlement profiles from compact topology templates. */
function generateProfileRoads(rng: Rng, params: RoadParams): RoadNetwork {
    const safeArea = inset(params.boundary, params.inset);
    const spacing = Math.max(params.frontage * 2.5, params.radius * 0.18);
    const context: RoadGenerationContext = {
        rng,
        safeArea,
        radius: params.radius,
        frontage: params.frontage,
        junctionSpacing: spacing,
        jitter: params.jitter,
        samples: params.samples,
        terrain: params.terrain,
        river: params.river,
        // Profile forms do not yet gate on terrain or the river (M12d); these keep
        // the context well-formed without changing their routing.
        fords: [],
        fordRadius: 0,
    };
    const segments: SegmentInput[] = [];
    const addRoute = (points: Vec2[], kind: RoadClass, width: number): void => {
        if (!points.every((point) => allowedPoint(params, safeArea, point))) return;
        for (let i = 1; i < points.length; i++) {
            if (dist(points[i - 1], points[i]) >= MIN_EDGE_LEN) segments.push({ a: points[i - 1], b: points[i], kind, width });
        }
    };
    const axis = params.layout.axis;
    const normal = perp(axis);
    const anchor = params.layout.anchor;
    const profile = params.layout.profile;

    if (profile === "estate") {
        // An estate has one legible access route rather than an internal street
        // network. Marking it primary lets M6 continue that route into the
        // surrounding countryside.
        addRoute(throughRoad(context, anchor, axis), "primary", params.primaryWidth);
        return planarize(segments);
    }

    if (profile === "reihendorf" || profile === "tenement") {
        addRoute(throughRoad(context, anchor, axis), "primary", params.primaryWidth);
        return planarize(segments);
    }

    if (profile === "weiler") {
        const trunk = throughRoad(context, anchor, axis);
        addRoute(trunk, "primary", params.primaryWidth);
        const offset = scale(normal, params.radius * 0.22);
        const side = throughRoad(context, add(anchor, offset), axis);
        addRoute(side, "track", params.laneWidth * 0.7);
        addConnector(params, safeArea, segments, pointAtFraction(trunk, 0.72), pointAtFraction(side, 0.72), "track", params.laneWidth * 0.7);
        return planarize(segments);
    }

    const green = params.layout.civicSpaces[0];
    const greenRadius = green ? Math.max(...green.polygon.map((point) => dist(point, anchor))) : params.radius * 0.14;
    const flankOffset = greenRadius + params.frontage * 0.8;
    const left = throughRoad(context, add(anchor, scale(normal, flankOffset)), axis);
    const right = throughRoad(context, add(anchor, scale(normal, -flankOffset)), axis);
    // Rundling keeps one principal entrance beside narrower frontage paths.
    // The closing paths remain tracks and therefore add no frontage.
    addRoute(left, "primary", params.primaryWidth);
    addRoute(right, profile === "rundling" ? "lane" : "primary", profile === "rundling" ? params.laneWidth : params.primaryWidth);
    const connectorKind: RoadClass = profile === "rundling" ? "track" : "secondary";
    const connectorWidth = profile === "rundling" ? params.laneWidth * 0.7 : params.secondaryWidth;
    // End connectors maintain movement without cutting through the reserved centre.
    addConnector(params, safeArea, segments, pointAtFraction(left, 0.16), pointAtFraction(right, 0.16), connectorKind, connectorWidth);
    if (profile === "angerdorf") {
        addConnector(params, safeArea, segments, pointAtFraction(left, 0.84), pointAtFraction(right, 0.84), connectorKind, connectorWidth);
    }
    return planarize(segments);
}

function addConnector(
    params: RoadParams,
    safeArea: Polygon,
    segments: SegmentInput[],
    a: Vec2,
    b: Vec2,
    kind: RoadClass,
    width: number,
): void {
    const points = dedupe(catmullRom([a, scale(add(a, b), 0.5), b], params.samples));
    if (!points.every((point) => allowedPoint(params, safeArea, point))) return;
    for (let i = 1; i < points.length; i++) {
        if (dist(points[i - 1], points[i]) >= MIN_EDGE_LEN) segments.push({ a: points[i - 1], b: points[i], kind, width });
    }
}

function allowedPoint(params: RoadParams, safeArea: Polygon, point: Vec2): boolean {
    return insideOrOn(safeArea, point) && !params.layout.civicSpaces.some((space) => contains(space.polygon, point));
}

/** Create a subtly bent through-road while keeping its endpoints on the inset boundary. */
function throughRoad(context: RoadGenerationContext, anchor: Vec2, axis: Vec2): Vec2[] {
    const { safeArea, radius, jitter, samples, rng } = context;
    const forward = normalize(axis);
    const endA = intersectRayPolygon(safeArea, anchor, forward)?.point ?? add(anchor, scale(forward, radius * 0.5));
    const endB = intersectRayPolygon(safeArea, anchor, scale(forward, -1))?.point ?? sub(anchor, scale(forward, radius * 0.5));
    const normal = perp(forward);
    const bend = rng.float(-jitter * 0.9, jitter * 0.9);
    const before = add(add(endA, scale(sub(anchor, endA), 0.5)), scale(normal, bend));
    const after = add(add(anchor, scale(sub(endB, anchor), 0.5)), scale(normal, -bend));
    const curved = dedupe(catmullRom([endA, before, anchor, after, endB], samples));

    // The boundary is intentionally organic rather than mathematically convex.
    // Fall back to a simpler spline if a bend bulges outside the inset.
    return curved.every((p) => insideOrOn(safeArea, p)) ? curved : dedupe(catmullRom([endA, anchor, endB], samples));
}

function findSecondaryConnector(
    context: RoadGenerationContext,
    primaryRoutes: readonly Vec2[][],
    junctions: readonly Vec2[],
): SecondaryConnector | null {
    const { rng, safeArea, radius, frontage, junctionSpacing, samples } = context;
    if (primaryRoutes.length < 2) return null;
    const minLength = frontage * 2.5;
    const tryPair = (first: Vec2[], second: Vec2[], aFraction: number, bFraction: number): SecondaryConnector | null => {
        const a = pointAtFraction(first, aFraction);
        const b = pointAtFraction(second, bFraction);
        const span = dist(a, b);
        if (span < minLength || span > radius * 0.6) return null;
        if (junctions.some((other) => dist(a, other) < junctionSpacing || dist(b, other) < junctionSpacing)) return null;
        if (dist(a, b) < junctionSpacing) return null;

        // A direct core cut-through may cross another corridor. Planarization
        // turns that crossing into a shared junction, which is more useful than
        // rejecting a valid route solely because it reconnects the graph.
        const midpoint = scale(add(a, b), 0.5);
        const points = dedupe(catmullRom([a, midpoint, b], samples));
        return points.every((point) => insideOrOn(safeArea, point)) && routeTraversable(context, points) ? { a, b, points } : null;
    };

    // Cross streets are separate corridors that both meet the trunk. Joining
    // them on one side of the trunk creates a full block, rather than a small
    // triangle around an intersection they already share with the trunk.
    for (let first = 1; first < primaryRoutes.length; first++) {
        for (let second = first + 1; second < primaryRoutes.length; second++) {
            for (const fraction of [0.18, 0.82]) {
                const loop = tryPair(
                    primaryRoutes[first],
                    primaryRoutes[second],
                    fraction + rng.float(-0.045, 0.045),
                    fraction + rng.float(-0.045, 0.045),
                );
                if (loop) return loop;
            }
        }
    }

    return null;
}

function findLaneBranch(context: RoadGenerationContext, routes: readonly Route[], junctions: readonly Vec2[]): LaneCandidate | null {
    const { rng, safeArea, radius, frontage, junctionSpacing, jitter, samples } = context;
    const hostRoutes = routes.filter((route) => route.kind === "primary" || route.kind === "secondary");
    if (hostRoutes.length === 0) return null;

    const minLength = frontage * MIN_LANE_LOTS;
    const roadSpacing = Math.max(frontage * 1.35, radius * 0.1);
    for (let attempt = 0; attempt < 12; attempt++) {
        const host = hostRoutes[rng.int(0, hostRoutes.length - 1)].points;
        const fraction = rng.float(0.18, 0.82);
        const anchor = pointAtFraction(host, fraction);
        if (junctions.some((other) => dist(anchor, other) < junctionSpacing)) continue;

        const tangent = tangentAtFraction(host, fraction);
        const direction = scale(perp(tangent), rng.chance(0.5) ? 1 : -1);
        const hit = intersectRayPolygon(safeArea, anchor, direction);
        const maxLength = Math.min(hit?.distance ?? radius * 0.35, radius * 0.38);
        if (maxLength < minLength) continue;
        const length = rng.float(minLength, maxLength * 0.88);
        const tip = add(anchor, scale(direction, length));
        const control = add(
            add(anchor, scale(direction, length * 0.5)),
            scale(tangent, rng.float(-jitter * 0.65, jitter * 0.65)),
        );
        const points = dedupe(catmullRom([anchor, control, tip], samples));
        if (!points.every((point) => insideOrOn(safeArea, point))) continue;
        if (!routeTraversable(context, points)) continue;
        if (!hasBranchClearance(points, [anchor], routes.map((route) => route.points), roadSpacing)) continue;
        return { anchor, points };
    }
    return null;
}

function primaryJunctions(trunk: Vec2[], crosses: readonly Vec2[][]): Vec2[] {
    const junctions: Vec2[] = [];
    for (const cross of crosses) {
        let best = cross[0];
        let bestDistance = Infinity;
        for (const point of cross) {
            const d = distanceToPolyline(point, trunk);
            if (d < bestDistance) {
                best = point;
                bestDistance = d;
            }
        }
        junctions.push(best);
    }
    return junctions;
}

function hasBranchClearance(
    points: readonly Vec2[],
    anchors: readonly Vec2[],
    routes: readonly Vec2[][],
    minSpacing: number,
): boolean {
    for (const point of points) {
        // Near its anchor, a branch intentionally shares its host corridor.
        if (anchors.some((anchor) => dist(point, anchor) <= minSpacing)) continue;
        if (routes.some((route) => distanceToPolyline(point, route) < minSpacing)) return false;
    }
    return true;
}

function tangentAtFraction(poly: Vec2[], fraction: number): Vec2 {
    const point = pointAtFraction(poly, fraction);
    let closest = 0;
    let closestDistance = Infinity;
    for (let i = 1; i < poly.length; i++) {
        const midpoint = scale(add(poly[i - 1], poly[i]), 0.5);
        const d = dist(point, midpoint);
        if (d < closestDistance) {
            closest = i;
            closestDistance = d;
        }
    }
    return normalize(sub(poly[closest], poly[closest - 1]));
}

function distanceToPolyline(point: Vec2, poly: readonly Vec2[]): number {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) best = Math.min(best, pointSegmentDistance(point, poly[i - 1], poly[i]));
    return best;
}

function pointSegmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
    const ab = sub(b, a);
    const lengthSq = ab.x * ab.x + ab.y * ab.y;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSq)) : 0;
    return dist(point, add(a, scale(ab, t)));
}

function insideOrOn(poly: Polygon, point: Vec2): boolean {
    return contains(poly, point) || distanceToBoundary(poly, point) < 1e-6;
}

/** Point a fraction of the way along a polyline by arc length. */
function pointAtFraction(poly: Vec2[], frac: number): Vec2 {
    let total = 0;
    for (let i = 1; i < poly.length; i++) total += dist(poly[i - 1], poly[i]);
    const target = total * Math.max(0, Math.min(1, frac));
    let travelled = 0;
    for (let i = 1; i < poly.length; i++) {
        const segmentLength = dist(poly[i - 1], poly[i]);
        if (travelled + segmentLength >= target) {
            const t = segmentLength > 0 ? (target - travelled) / segmentLength : 0;
            return add(poly[i - 1], scale(sub(poly[i], poly[i - 1]), t));
        }
        travelled += segmentLength;
    }
    return poly[poly.length - 1];
}

function rotate(p: Vec2, radians: number): Vec2 {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Drop consecutive points closer than MIN_EDGE_LEN so no zero-length edges form. */
function dedupe(points: Vec2[]): Vec2[] {
    const out: Vec2[] = [];
    for (const p of points) {
        if (out.length === 0 || dist(out[out.length - 1], p) >= MIN_EDGE_LEN) out.push(p);
    }
    return out;
}
