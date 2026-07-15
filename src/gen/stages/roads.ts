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

import type { Polygon, RoadNetwork, Vec2 } from "../types";
import type { Rng } from "../rng";
import { centroid, contains, distanceToBoundary, inset, intersectRayPolygon } from "../geometry/polygon";
import { catmullRom } from "../geometry/catmullRom";
import { planarize, type SegmentInput } from "../geometry/graph";
import { add, dist, normalize, perp, scale, sub } from "../geometry/vec2";

export interface RoadParams {
    boundary: Polygon;
    radius: number;
    /** Target number of primary roads; generation varies this slightly by seed. */
    primaryCount: number;
    samples: number;
    /** Trunk-road anchor jitter, world units. */
    jitter: number;
    /** Margin keeping roads inside the boundary, world units. */
    inset: number;
    /** Soft growth budget for secondary connectors. */
    secondaryCount: number;
    /** Soft growth budget for lane branches. */
    laneCount: number;
    primaryWidth: number;
    secondaryWidth: number;
    laneWidth: number;
    /** Typical lot frontage, used to keep branch roads useful and well spaced. */
    frontage: number;
}

const MIN_EDGE_LEN = 1e-3;

export function generateRoads(rng: Rng, params: RoadParams): RoadNetwork {
    const { boundary, radius, primaryCount, samples, jitter, inset: margin } = params;
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

    // Primary through-roads. Start with a trunk, then place mostly parallel cross
    // streets at separated points on it. This is a compact, intentionally loose
    // grid: irregular enough to avoid a city-block pattern, but still legible.
    const primaries: Vec2[][] = [];
    const primaryAnchors: Vec2[] = [];
    const primaryAnchorSpacing = Math.max(params.frontage * 2.5, radius * 0.18);
    const baseAngle = rng.float(0, Math.PI);
    const trunkAxis: Vec2 = { x: Math.cos(baseAngle), y: Math.sin(baseAngle) };
    const trunk = throughRoad(safeArea, trunkAnchor, trunkAxis, radius, jitter, samples, rng);
    primaries.push(trunk);
    pushPolyline(trunk, "primary", params.primaryWidth);

    const crossAxisBase = perp(trunkAxis);
    const primaryFloor = primaryCount >= 3 ? 3 : 1;
    const primaryTarget = Math.max(primaryFloor, primaryCount + (primaryCount > 1 ? rng.int(-1, 1) : 0));
    for (let p = 1; p < primaryTarget; p++) {
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
        primaryAnchors.push(anchor);
        const axis = rotate(crossAxisBase, rng.float(-0.24, 0.24));
        const poly = throughRoad(safeArea, anchor, axis, radius, jitter, samples, rng);
        primaries.push(poly);
        pushPolyline(poly, "primary", params.primaryWidth);
    }

    const routes = [...primaries];
    const junctions = primaryJunctions(trunk, primaries.slice(1));
    const junctionSpacing = primaryAnchorSpacing;

    // The secondary budget is deliberately soft. Each accepted road is a curved,
    // two-ended connector that closes a block or reconnects an existing secondary
    // corridor; unsuitable slots remain empty instead of becoming orphan branches.
    const secondaryBudget = Math.max(0, params.secondaryCount + rng.int(-1, 2));
    for (let i = 0; i < secondaryBudget; i++) {
        const loop = findLoop(rng, safeArea, primaries, junctions, radius, params.frontage, junctionSpacing, samples);
        if (loop) {
            junctions.push(loop.a, loop.b);
            routes.push(loop.points);
            pushPolyline(loop.points, "secondary", params.secondaryWidth);
        }
    }

    // Lanes remain logical branches, rather than being used as a fixed grid fill.
    const addBranches = (count: number, kind: SegmentInput["kind"], width: number, minLots: number): void => {
        for (let i = 0; i < count; i++) {
            const branch = findBranch(
                rng,
                safeArea,
                routes,
                junctions,
                radius,
                params.frontage,
                junctionSpacing,
                minLots,
                jitter,
                samples,
            );
            if (!branch) continue;
            junctions.push(branch.anchor);
            routes.push(branch.points);
            pushPolyline(branch.points, kind, width);
        }
    };

    addBranches(Math.max(0, params.laneCount + rng.int(-1, 1)), "lane", params.laneWidth, 2);

    return planarize(segments);
}

/** Create a subtly bent through-road while keeping its endpoints on the inset boundary. */
function throughRoad(
    safeArea: Polygon,
    anchor: Vec2,
    axis: Vec2,
    radius: number,
    jitter: number,
    samples: number,
    rng: Rng,
): Vec2[] {
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

interface Branch {
    anchor: Vec2;
    points: Vec2[];
}

interface Loop {
    a: Vec2;
    b: Vec2;
    points: Vec2[];
}

function findLoop(
    rng: Rng,
    safeArea: Polygon,
    primaryRoutes: readonly Vec2[][],
    junctions: readonly Vec2[],
    radius: number,
    frontage: number,
    junctionSpacing: number,
    samples: number,
): Loop | null {
    if (primaryRoutes.length < 2) return null;
    const minLength = frontage * 2.5;
    const tryPair = (first: Vec2[], second: Vec2[], aFraction: number, bFraction: number): Loop | null => {
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
        return points.every((point) => insideOrOn(safeArea, point)) ? { a, b, points } : null;
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

function findBranch(
    rng: Rng,
    safeArea: Polygon,
    routes: readonly Vec2[][],
    junctions: readonly Vec2[],
    radius: number,
    frontage: number,
    junctionSpacing: number,
    minLots: number,
    jitter: number,
    samples: number,
): Branch | null {
    const minLength = frontage * minLots;
    const roadSpacing = Math.max(frontage * 1.35, radius * 0.1);
    for (let attempt = 0; attempt < 12; attempt++) {
        const host = routes[rng.int(0, routes.length - 1)];
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
        if (!hasConnectorClearance(points, [anchor], routes, roadSpacing)) continue;
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

function hasConnectorClearance(
    points: readonly Vec2[],
    anchors: readonly Vec2[],
    routes: readonly Vec2[][],
    minSpacing: number,
    hostRoutes: readonly Vec2[][] = [],
): boolean {
    for (const point of points) {
        // Near an endpoint, a connector intentionally shares its host corridor.
        if (anchors.some((anchor) => dist(point, anchor) <= minSpacing)) continue;
        if (routes.some((route) => !hostRoutes.includes(route) && distanceToPolyline(point, route) < minSpacing)) return false;
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
