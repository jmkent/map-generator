// Structural river generation and road-crossing integration. PURE.

import type { Bounds, River, RoadEdge, RoadNetwork, RoadNode, Vec2 } from "../types";
import type { Rng } from "../rng";
import { catmullRom } from "../geometry/catmullRom";
import { lerp, sub } from "../geometry/vec2";

export interface RiverParams {
    mapBounds: Bounds;
    radius: number;
    width: number;
}

/** Create a seeded, gently meandering channel from one map edge to its opposite. */
export function generateRiver(rng: Rng, params: RiverParams): River {
    const { mapBounds, radius, width } = params;
    const horizontal = rng.chance(0.5);
    const span = horizontal ? mapBounds.maxX - mapBounds.minX : mapBounds.maxY - mapBounds.minY;
    const crossMin = horizontal ? mapBounds.minY : mapBounds.minX;
    const crossMax = horizontal ? mapBounds.maxY : mapBounds.maxX;
    const startCross = rng.float(crossMin + (crossMax - crossMin) * 0.2, crossMin + (crossMax - crossMin) * 0.42);
    const endCross = rng.float(crossMin + (crossMax - crossMin) * 0.58, crossMin + (crossMax - crossMin) * 0.8);
    const meander = Math.min(radius * 0.24, (crossMax - crossMin) * 0.17);
    const controls: Vec2[] = horizontal
        ? [
            { x: mapBounds.minX, y: startCross },
            { x: mapBounds.minX + span * 0.28, y: clamp(startCross + rng.float(-meander, meander), crossMin, crossMax) },
            { x: mapBounds.minX + span * 0.68, y: clamp(endCross + rng.float(-meander, meander), crossMin, crossMax) },
            { x: mapBounds.maxX, y: endCross },
        ]
        : [
            { x: startCross, y: mapBounds.minY },
            { x: clamp(startCross + rng.float(-meander, meander), crossMin, crossMax), y: mapBounds.minY + span * 0.28 },
            { x: clamp(endCross + rng.float(-meander, meander), crossMin, crossMax), y: mapBounds.minY + span * 0.68 },
            { x: endCross, y: mapBounds.maxY },
        ];
    return { kind: "river", path: catmullRom(controls, 10), width };
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
            if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6) splits.push({ t: hit.t, point: hit.point, crossing: true });
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

function pointSegmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
    const ab = sub(b, a);
    const lengthSq = ab.x * ab.x + ab.y * ab.y;
    const t = lengthSq === 0 ? 0 : clamp(((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSq, 0, 1);
    return Math.hypot(point.x - (a.x + ab.x * t), point.y - (a.y + ab.y * t));
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
