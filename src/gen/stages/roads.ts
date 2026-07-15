// Road network stage: a curved main street across the village plus perpendicular
// branch stubs, emitted as a graph (nodes + straight edges). PURE.
//
// The main street runs between two points on an inset of the boundary (so it
// stays clear of the edge), curving through jittered interior control points via
// a centripetal Catmull–Rom spline. Branches drop off main-street nodes along the
// local normal, clipped to stop short of the boundary. Keeping the network a
// graph lets later milestones grow it into a real street layout without a rewrite.

import type { Polygon, RoadEdge, RoadNetwork, RoadNode, Vec2 } from "../types";
import type { Rng } from "../rng";
import { centroid, contains, inset, intersectRayPolygon } from "../geometry/polygon";
import { catmullRom } from "../geometry/catmullRom";
import { add, dist, normalize, perp, scale, sub } from "../geometry/vec2";

export interface RoadParams {
    boundary: Polygon;
    radius: number;
    controlPoints: number;
    samples: number;
    /** Perpendicular control-point jitter, world units. */
    jitter: number;
    /** Margin keeping roads inside the boundary, world units. */
    inset: number;
    branchCount: number;
    mainWidth: number;
    branchWidth: number;
}

const MIN_EDGE_LEN = 1e-3;

export function generateRoads(rng: Rng, params: RoadParams): RoadNetwork {
    const { boundary, radius, controlPoints, samples, jitter, inset: margin } = params;
    const center = centroid(boundary);
    const safeArea = inset(boundary, margin);

    // Main-street endpoints: opposite crossings of the inset boundary along a
    // random axis through the center.
    const theta = rng.float(0, Math.PI);
    const axis: Vec2 = { x: Math.cos(theta), y: Math.sin(theta) };
    const endA = intersectRayPolygon(safeArea, center, axis)?.point ?? add(center, scale(axis, radius * 0.5));
    const endB = intersectRayPolygon(safeArea, center, scale(axis, -1))?.point ?? sub(center, scale(axis, radius * 0.5));

    // Interior control points along the axis, jittered perpendicular, kept inside.
    const normal = normalize(perp(sub(endB, endA)));
    const control: Vec2[] = [endA];
    for (let k = 1; k <= controlPoints; k++) {
        const t = k / (controlPoints + 1);
        const base = add(endA, scale(sub(endB, endA), t));
        const offset = rng.float(-jitter, jitter);
        const candidate = add(base, scale(normal, offset));
        control.push(contains(safeArea, candidate) ? candidate : base);
    }
    control.push(endB);

    const polyline = dedupe(catmullRom(control, samples));

    const nodes: RoadNode[] = [];
    const edges: RoadEdge[] = [];
    const addNode = (pos: Vec2): number => {
        const id = nodes.length;
        nodes.push({ id, pos });
        return id;
    };

    // Main street: a chain of nodes joined by "main" edges.
    const mainIds = polyline.map(addNode);
    for (let i = 1; i < mainIds.length; i++) {
        edges.push({ a: mainIds[i - 1], b: mainIds[i], kind: "main", width: params.mainWidth });
    }

    // Branch stubs: pick interior main nodes, head along the local normal, and
    // clip to stop short of the boundary.
    const branchAnchors = pickAnchors(mainIds.length, params.branchCount, rng);
    for (const idx of branchAnchors) {
        const here = polyline[idx];
        const ahead = polyline[Math.min(idx + 1, polyline.length - 1)];
        const behind = polyline[Math.max(idx - 1, 0)];
        const tangent = normalize(sub(ahead, behind));
        const side = rng.chance(0.5) ? 1 : -1;
        const dir = scale(perp(tangent), side);

        const hit = intersectRayPolygon(boundary, here, dir);
        const maxLen = hit ? hit.distance - margin : radius * 0.3;
        if (maxLen < radius * 0.08) continue;
        const len = Math.min(rng.float(0.18, 0.42) * radius, maxLen * 0.9);
        const tip = add(here, scale(dir, len));
        if (dist(here, tip) < MIN_EDGE_LEN) continue;

        const tipId = addNode(tip);
        edges.push({ a: mainIds[idx], b: tipId, kind: "branch", width: params.branchWidth });
    }

    return { nodes, edges };
}

/** Drop consecutive points closer than MIN_EDGE_LEN so no zero-length edges form. */
function dedupe(points: Vec2[]): Vec2[] {
    const out: Vec2[] = [];
    for (const p of points) {
        if (out.length === 0 || dist(out[out.length - 1], p) >= MIN_EDGE_LEN) out.push(p);
    }
    return out;
}

/** Evenly spaced interior indices (excluding the two end nodes) for branch roots. */
function pickAnchors(count: number, branches: number, rng: Rng): number[] {
    if (count < 3 || branches <= 0) return [];
    const anchors: number[] = [];
    for (let i = 1; i <= branches; i++) {
        const base = (i / (branches + 1)) * (count - 1);
        const jittered = Math.round(base + rng.float(-1, 1));
        anchors.push(Math.max(1, Math.min(count - 2, jittered)));
    }
    return anchors;
}
