// Parcel stage: burgage-style lots lining the streets. PURE.
//
// Each road polyline is walked by arc length and divided into frontage intervals;
// each interval spawns a candidate lot quad on both sides, set back from the road.
// Candidates are accepted greedily — kept only if they sit inside the boundary,
// clear of every road corridor and of already-accepted lots — and thinned by a
// center-weighted density falloff, which produces a denser core (the "clumps").

import type { Parcel, Polygon, RoadNetwork, Vec2 } from "../types";
import type { Rng } from "../rng";
import { centroid, contains, convexOverlap, ensureCCW } from "../geometry/polygon";
import { add, dist, normalize, perp, scale, sub } from "../geometry/vec2";

export interface ParcelParams {
    boundary: Polygon;
    roads: RoadNetwork;
    radius: number;
    lotWidth: number;
    lotDepth: number;
    lotSetback: number;
    lotWidthJitter: number;
    density: number;
}

interface Corridor {
    rect: Polygon;
}

export function generateParcels(rng: Rng, params: ParcelParams): Parcel[] {
    const { boundary, roads, radius, lotWidth, lotDepth, lotSetback, lotWidthJitter, density } = params;
    const center = centroid(boundary);
    const posById = new Map(roads.nodes.map((n) => [n.id, n.pos]));

    const corridors: Corridor[] = roads.edges.map((e) => ({
        rect: edgeRect(posById.get(e.a)!, posById.get(e.b)!, e.width),
    }));

    const accepted: Parcel[] = [];

    for (const line of roadPolylines(roads)) {
        const frontOffset = line.width / 2 + lotSetback;
        const backOffset = frontOffset + lotDepth;

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
                if (corridors.some((c) => convexOverlap(lot, c.rect, 0.05))) continue;
                if (accepted.some((p) => convexOverlap(lot, p.polygon, 0.05))) continue;

                // Center-weighted acceptance: p ~ 1 at the core, tapering outward.
                const dNorm = dist(centroid(lot), center) / radius;
                const p = clamp(1.05 - dNorm * dNorm, 0.15, 1) * density;
                if (rng.next() >= p) continue;

                accepted.push({ polygon: lot });
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

interface Polyline {
    points: Vec2[];
    width: number;
}

/** Reconstruct ordered polylines from the road graph: the main street as one
 *  chain, each branch as its own two-point line. Order is deterministic. */
function roadPolylines(net: RoadNetwork): Polyline[] {
    const posById = new Map(net.nodes.map((n) => [n.id, n.pos]));
    const lines: Polyline[] = [];

    const mainEdges = net.edges.filter((e) => e.kind === "main");
    if (mainEdges.length > 0) {
        const adj = new Map<number, number[]>();
        const link = (from: number, to: number) => {
            const list = adj.get(from);
            if (list) list.push(to);
            else adj.set(from, [to]);
        };
        for (const e of mainEdges) {
            link(e.a, e.b);
            link(e.b, e.a);
        }
        const ends = [...adj.entries()].filter(([, ns]) => ns.length === 1).map(([id]) => id);
        const start = ends.length > 0 ? Math.min(...ends) : Math.min(...adj.keys());

        const order: number[] = [start];
        const seen = new Set<number>([start]);
        let current = start;
        while (true) {
            const next = (adj.get(current) ?? []).find((n) => !seen.has(n));
            if (next === undefined) break;
            seen.add(next);
            order.push(next);
            current = next;
        }
        lines.push({ points: order.map((id) => posById.get(id)!), width: mainEdges[0].width });
    }

    for (const e of net.edges) {
        if (e.kind === "branch") {
            lines.push({ points: [posById.get(e.a)!, posById.get(e.b)!], width: e.width });
        }
    }

    return lines;
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

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}
