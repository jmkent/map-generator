// Road network stage: a small hierarchy — primary through-roads, secondary
// connectors, and lane stubs — planarized into one connected graph. PURE.
//
// A gently curved trunk runs across the settlement. The other primaries are
// roughly parallel cross streets, attached at different points along that trunk;
// this produces several ordinary junctions and loose blocks rather than a single
// plaza where every road converges. Secondaries join neighbouring corridors on
// distributed positions, while lanes add short frontage spurs. The soup
// of segments is handed to `planarize`, which splits every crossing into a shared
// node.

import type { Polygon, RoadNetwork, Vec2 } from "../types";
import type { Rng } from "../rng";
import { centroid, contains, inset, intersectRayPolygon } from "../geometry/polygon";
import { catmullRom } from "../geometry/catmullRom";
import { planarize, type SegmentInput } from "../geometry/graph";
import { add, dist, normalize, perp, scale, sub } from "../geometry/vec2";

export interface RoadParams {
    boundary: Polygon;
    radius: number;
    primaryCount: number;
    samples: number;
    /** Trunk-road anchor jitter, world units. */
    jitter: number;
    /** Margin keeping roads inside the boundary, world units. */
    inset: number;
    secondaryCount: number;
    laneCount: number;
    primaryWidth: number;
    secondaryWidth: number;
    laneWidth: number;
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
    const baseAngle = rng.float(0, Math.PI);
    const trunkAxis: Vec2 = { x: Math.cos(baseAngle), y: Math.sin(baseAngle) };
    const trunk = throughRoad(safeArea, trunkAnchor, trunkAxis, radius, jitter, samples, rng);
    primaries.push(trunk);
    pushPolyline(trunk, "primary", params.primaryWidth);

    const crossAxisBase = perp(trunkAxis);
    for (let p = 1; p < primaryCount; p++) {
        const pair = Math.ceil(p / 2);
        const side = p % 2 === 1 ? -1 : 1;
        const frac = Math.max(0.2, Math.min(0.8, 0.5 + side * (0.2 + (pair - 1) * 0.12) + rng.float(-0.035, 0.035)));
        const anchor = pointAtFraction(trunk, frac);
        const axis = rotate(crossAxisBase, rng.float(-0.22, 0.22));
        const poly = throughRoad(safeArea, anchor, axis, radius, jitter, samples, rng);
        primaries.push(poly);
        pushPolyline(poly, "primary", params.primaryWidth);
    }

    // Secondary connectors bridge neighbouring cross streets. Their positions
    // are spread along each pair, avoiding reverse-order duplicate links.
    // With one cross street they make small loops back to the trunk.
    for (let s = 0; s < params.secondaryCount; s++) {
        if (primaries.length < 2) break;
        const crossCount = primaries.length - 1;
        const pairCount = Math.max(1, crossCount - 1);
        const pair = s % pairCount;
        const ia = crossCount === 1 ? 1 : 1 + pair;
        const ib = crossCount === 1 ? 0 : ia + 1;
        const band = Math.floor(s / pairCount);
        const bands = Math.ceil(params.secondaryCount / pairCount);
        const baseFrac = 0.2 + (0.6 * (band + 1)) / (bands + 1);
        const va = pointAtFraction(primaries[ia], baseFrac + rng.float(-0.045, 0.045));
        const vb = pointAtFraction(primaries[ib], baseFrac + rng.float(-0.045, 0.045));
        const span = dist(va, vb);
        if (span >= radius * 0.12 && span <= radius * 0.85 && segmentInside(boundary, va, vb)) {
            pushPolyline([va, vb], "secondary", params.secondaryWidth);
        }
    }

    // Lane stubs: short spurs off primary vertices, clipped inside the boundary.
    for (let l = 0; l < params.laneCount; l++) {
        const poly = primaries[rng.int(0, primaries.length - 1)];
        if (poly.length < 3) continue;
        const idx = rng.int(1, poly.length - 2);
        const here = poly[idx];
        const tangent = normalize(sub(poly[idx + 1], poly[idx - 1]));
        const dir = scale(perp(tangent), rng.chance(0.5) ? 1 : -1);

        const hit = intersectRayPolygon(boundary, here, dir);
        const maxLen = hit ? hit.distance - margin : radius * 0.3;
        if (maxLen < radius * 0.08) continue;
        const len = Math.min(rng.float(0.15, 0.35) * radius, maxLen * 0.9);
        const tip = add(here, scale(dir, len));
        if (dist(here, tip) < MIN_EDGE_LEN) continue;
        pushPolyline([here, tip], "lane", params.laneWidth);
    }

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
    const bend = rng.float(-jitter * 0.35, jitter * 0.35);
    const before = add(add(endA, scale(sub(anchor, endA), 0.5)), scale(normal, bend));
    const after = add(add(anchor, scale(sub(endB, anchor), 0.5)), scale(normal, -bend));
    const curved = dedupe(catmullRom([endA, before, anchor, after, endB], samples));

    // The boundary is intentionally organic rather than mathematically convex.
    // Fall back to a simpler spline if a bend bulges outside the inset.
    return curved.every((p) => contains(safeArea, p)) ? curved : dedupe(catmullRom([endA, anchor, endB], samples));
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

/** True if a straight segment stays inside the boundary (sampled). */
function segmentInside(boundary: Polygon, a: Vec2, b: Vec2, steps = 8): boolean {
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (!contains(boundary, add(a, scale(sub(b, a), t)))) return false;
    }
    return true;
}

/** Drop consecutive points closer than MIN_EDGE_LEN so no zero-length edges form. */
function dedupe(points: Vec2[]): Vec2[] {
    const out: Vec2[] = [];
    for (const p of points) {
        if (out.length === 0 || dist(out[out.length - 1], p) >= MIN_EDGE_LEN) out.push(p);
    }
    return out;
}
