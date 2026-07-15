// Road-graph planarization. PURE.
//
// Takes a soup of straight segments (sampled from primary/secondary/lane
// polylines) and turns it into a planar graph: every pairwise crossing is split
// into a shared junction node, and coincident endpoints are merged. The result
// is a RoadNetwork whose edges meet only at nodes — which is what makes the
// network genuinely connected and lets parcels walk clean chains between
// junctions.

import type { RoadClass, RoadEdge, RoadNetwork, Vec2 } from "../types";
import { add, cross, scale, sub } from "./vec2";

export interface SegmentInput {
    a: Vec2;
    b: Vec2;
    kind: RoadClass;
    width: number;
}

interface Split {
    t: number;
    point: Vec2;
}

/** Segment/segment intersection with parameters, or null if they don't meet. */
function segIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): { point: Vec2; ti: number; tj: number } | null {
    const r = sub(a2, a1);
    const s = sub(b2, b1);
    const denom = cross(r, s);
    if (Math.abs(denom) < 1e-12) return null; // parallel or collinear
    const qp = sub(b1, a1);
    const ti = cross(qp, s) / denom;
    const tj = cross(qp, r) / denom;
    if (ti < -1e-9 || ti > 1 + 1e-9 || tj < -1e-9 || tj > 1 + 1e-9) return null;
    return { point: add(a1, scale(r, ti)), ti, tj };
}

/**
 * Build a planar RoadNetwork from straight segments. Crossings become shared
 * nodes; edges keep the class/width of the segment they came from; duplicate
 * edges between the same node pair are collapsed. `eps` is the world-space merge
 * tolerance for coincident points.
 *
 * "Interior" is judged in world space per segment (a crossing within `eps` of an
 * endpoint snaps to it), so that a crossing near the end of a long segment merges
 * onto the shared endpoint node rather than leaving an unshared near-endpoint
 * split — which would break planarity.
 */
export function planarize(segments: readonly SegmentInput[], eps = 1e-3): RoadNetwork {
    const nodes: Vec2[] = [];
    const nodeId = (p: Vec2): number => {
        for (let i = 0; i < nodes.length; i++) {
            if (Math.abs(nodes[i].x - p.x) <= eps && Math.abs(nodes[i].y - p.y) <= eps) return i;
        }
        nodes.push({ x: p.x, y: p.y });
        return nodes.length - 1;
    };

    // Per-segment t tolerance corresponding to `eps` world units near an endpoint.
    const tEps = segments.map((s) => eps / Math.max(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), eps));

    // Each segment starts split at its endpoints; crossings add interior splits.
    const splits: Split[][] = segments.map((s) => [
        { t: 0, point: s.a },
        { t: 1, point: s.b },
    ]);

    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const hit = segIntersect(segments[i].a, segments[i].b, segments[j].a, segments[j].b);
            if (!hit) continue;
            if (hit.ti > tEps[i] && hit.ti < 1 - tEps[i]) splits[i].push({ t: hit.ti, point: hit.point });
            if (hit.tj > tEps[j] && hit.tj < 1 - tEps[j]) splits[j].push({ t: hit.tj, point: hit.point });
        }
    }

    const edges: RoadEdge[] = [];
    const edgeKeys = new Set<string>();
    segments.forEach((seg, i) => {
        const ordered = splits[i].slice().sort((p, q) => p.t - q.t);
        const unique: Split[] = [];
        for (const sp of ordered) {
            if (unique.length === 0 || sp.t - unique[unique.length - 1].t > tEps[i]) unique.push(sp);
        }
        for (let k = 1; k < unique.length; k++) {
            const a = nodeId(unique[k - 1].point);
            const b = nodeId(unique[k].point);
            if (a === b) continue;
            const key = a < b ? `${a}-${b}` : `${b}-${a}`;
            if (edgeKeys.has(key)) continue;
            edgeKeys.add(key);
            edges.push({ a, b, kind: seg.kind, width: seg.width });
        }
    });

    return { nodes: nodes.map((pos, id) => ({ id, pos })), edges };
}

export interface Chain {
    points: Vec2[];
    width: number;
    kind: RoadClass;
}

/**
 * Extract maximal polylines from a road graph: each runs between junction/endpoint
 * nodes (degree ≠ 2), threading through degree-2 nodes. Class/width come from the
 * chain's first edge (uniform along a chain, since class changes happen at
 * junctions). Order is deterministic.
 */
export function roadChains(net: RoadNetwork): Chain[] {
    const posById = new Map(net.nodes.map((n) => [n.id, n.pos]));
    const adj = new Map<number, Array<{ to: number; edge: number }>>();
    for (const n of net.nodes) adj.set(n.id, []);
    net.edges.forEach((e, ei) => {
        adj.get(e.a)!.push({ to: e.b, edge: ei });
        adj.get(e.b)!.push({ to: e.a, edge: ei });
    });
    const degree = (id: number): number => adj.get(id)!.length;
    const used = new Set<number>();
    const chains: Chain[] = [];

    const walk = (start: number, first: { to: number; edge: number }): void => {
        used.add(first.edge);
        const points = [posById.get(start)!, posById.get(first.to)!];
        const { width, kind } = net.edges[first.edge];
        let cur = first.to;
        let viaEdge = first.edge;
        while (degree(cur) === 2) {
            const next = adj.get(cur)!.find((c) => c.edge !== viaEdge && !used.has(c.edge));
            if (!next) break;
            used.add(next.edge);
            points.push(posById.get(next.to)!);
            cur = next.to;
            viaEdge = next.edge;
        }
        chains.push({ points, width, kind });
    };

    const starts = net.nodes
        .filter((n) => degree(n.id) !== 2)
        .map((n) => n.id)
        .sort((a, b) => a - b);
    for (const start of starts) {
        for (const conn of adj.get(start)!) {
            if (!used.has(conn.edge)) walk(start, conn);
        }
    }

    // Pure cycles (all degree 2) leave edges unused; emit them per remaining edge.
    net.edges.forEach((e, ei) => {
        if (used.has(ei)) return;
        used.add(ei);
        chains.push({ points: [posById.get(e.a)!, posById.get(e.b)!], width: e.width, kind: e.kind });
    });

    return chains;
}

/** Count connected components of the graph (for connectivity checks). */
export function componentCount(net: RoadNetwork): number {
    const adj = new Map<number, number[]>();
    for (const n of net.nodes) adj.set(n.id, []);
    for (const e of net.edges) {
        adj.get(e.a)!.push(e.b);
        adj.get(e.b)!.push(e.a);
    }
    const seen = new Set<number>();
    let count = 0;
    for (const n of net.nodes) {
        if (seen.has(n.id)) continue;
        count++;
        const stack = [n.id];
        seen.add(n.id);
        while (stack.length) {
            for (const to of adj.get(stack.pop()!)!) {
                if (!seen.has(to)) {
                    seen.add(to);
                    stack.push(to);
                }
            }
        }
    }
    return count;
}
