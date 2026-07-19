// Parcel stage: burgage-style lots lining the streets. PURE.
//
// Each road polyline is walked by arc length and divided into frontage intervals;
// each interval spawns a candidate lot quad on both sides, set back from the road.
// Candidates are accepted greedily — kept only if they sit inside the boundary,
// clear of every road corridor and of already-accepted lots — and thinned by a
// center-weighted density falloff, which produces a denser core (the "clumps").

import { ROAD_CLASS_POLICIES, type Parcel, type Polygon, type RoadNetwork, type SettlementLayout, type Vec2, type WaterBody } from "../types";
import type { Rng } from "../rng";
import { centroid, contains, convexOverlap, ensureCCW, polygonsOverlap } from "../geometry/polygon";
import { clamp } from "../geometry/scalar";
import { roadChains } from "../geometry/graph";
import { add, dist, normalize, perp, scale, sub } from "../geometry/vec2";
import { distanceToWater } from "./water";

export interface ParcelParams {
    boundary: Polygon;
    roads: RoadNetwork;
    radius: number;
    lotWidth: number;
    lotDepth: number;
    lotSetback: number;
    lotWidthJitter: number;
    density: number;
    layout: SettlementLayout;
    water: WaterBody[];
}

interface Corridor {
    rect: Polygon;
}

export function generateParcels(rng: Rng, params: ParcelParams): Parcel[] {
    const { boundary, roads, radius, lotWidth, lotDepth, lotSetback, lotWidthJitter, density, layout, water } = params;
    const center = centroid(boundary);
    const posById = new Map(roads.nodes.map((n) => [n.id, n.pos]));

    const corridors: Corridor[] = roads.edges.map((e) => ({
        rect: edgeRect(posById.get(e.a)!, posById.get(e.b)!, e.width),
    }));
    for (const body of water) {
        if (body.kind === "river") {
            for (let i = 1; i < body.path.length; i++) corridors.push({ rect: edgeRect(body.path[i - 1], body.path[i], body.width) });
        }
    }

    const accepted: Parcel[] = [];

    for (const line of roadChains(roads)) {
        if (!ROAD_CLASS_POLICIES[line.kind].supportsFrontage) continue;
        const frontOffset = line.width / 2 + lotSetback;
        const depthMultiplier = layout.profile === "tenement" ? 2 : 1;
        const backOffset = frontOffset + lotDepth * depthMultiplier;

        for (const seg of subdivideByLength(line.points, lotWidth, lotWidthJitter, rng)) {
            const dir = normalize(sub(seg.b, seg.a));
            if (dir.x === 0 && dir.y === 0) continue;
            const normal = perp(dir);

            for (const side of [1, -1]) {
                const off = scale(normal, side);
                const lot = ensureCCW([
                    add(seg.a, scale(off, frontOffset)),
                    add(seg.b, scale(off, frontOffset)),
                    add(seg.b, scale(off, backOffset)),
                    add(seg.a, scale(off, backOffset)),
                ]);

                if (!lot.every((c) => contains(boundary, c))) continue;
                // Greens are convex just like lots, so SAT catches both the
                // obvious corner case and a lot spanning across a common.
                if (layout.civicSpaces.some((space) => convexOverlap(lot, space.polygon, 0))) continue;
                // Coastlines are traced and can be concave, so use the general
                // (non-convex) overlap test to keep lots out of the water. A lot
                // sitting entirely on a land island (inside a hole) is not in water.
                if (water.some((body) => body.kind !== "river"
                    && polygonsOverlap(lot, body.polygon)
                    && !(body.holes ?? []).some((hole) => lot.every((c) => contains(hole, c))))) continue;
                if (corridors.some((c) => convexOverlap(lot, c.rect, 0.05))) continue;
                if (accepted.some((p) => convexOverlap(lot, p.polygon, 0.05))) continue;

                // Center-weighted acceptance: p ~ 1 at the core, tapering outward.
                // The hierarchy matters too: wider primary streets support the
                // densest frontage, while lanes remain a sparse extension.
                const dNorm = dist(centroid(lot), center) / radius;
                const hierarchyDensity = line.kind === "primary" ? 1 : line.kind === "secondary" ? 0.82 : 0.65;
                const bankBias = water.reduce((best, body) => {
                    const d = distanceToWater(centroid(lot), body);
                    const strength = body.kind === "pond" ? 1.1 : body.kind === "lake" || body.kind === "coast" ? 1.28 : 1.22;
                    return Math.max(best, clamp(strength - d / (radius * 0.42), 0.68, strength));
                }, 1);
                const p = clamp(1.05 - dNorm * dNorm, 0.15, 1) * density * hierarchyDensity * bankBias;
                if (rng.next() >= p) continue;

                accepted.push({ polygon: lot, frontage: [seg.a, seg.b], roadKind: line.kind, buildablePolygon: lot });
            }
        }
    }

    return accepted;
}

/** Rectangle covering a road edge of the given width (CCW quad). */
function edgeRect(a: Vec2, b: Vec2, width: number): Polygon {
    const h = scale(normalize(perp(sub(b, a))), width / 2);
    return ensureCCW([sub(a, h), add(a, h), add(b, h), sub(b, h)]);
}

interface Segment {
    a: Vec2;
    b: Vec2;
}

/** Walk a polyline by arc length, emitting frontage intervals of ~`step` units. */
function subdivideByLength(points: Vec2[], step: number, jitter: number, rng: Rng): Segment[] {
    const total = polylineLength(points);
    const segments: Segment[] = [];
    let s = 0;
    while (s < total - 1e-6) {
        const width = step * (1 + rng.float(-jitter, jitter));
        const next = Math.min(total, s + Math.max(step * 0.5, width));
        segments.push({ a: pointAtLength(points, s), b: pointAtLength(points, next) });
        s = next;
    }
    return segments;
}

function polylineLength(points: Vec2[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
    return total;
}

function pointAtLength(points: Vec2[], target: number): Vec2 {
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
        const segLen = dist(points[i - 1], points[i]);
        if (acc + segLen >= target) {
            const t = segLen > 0 ? (target - acc) / segLen : 0;
            return add(points[i - 1], scale(sub(points[i], points[i - 1]), t));
        }
        acc += segLen;
    }
    return points[points.length - 1];
}
