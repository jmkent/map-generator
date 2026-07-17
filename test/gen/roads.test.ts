import { describe, expect, it } from "vitest";

import type { MapModel, RoadNetwork } from "../../src/gen/types";
import { generateVillage, DEFAULT_PARAMS } from "../../src/gen/pipeline";
import { createRng } from "../../src/gen/rng";
import { generateBoundary } from "../../src/gen/stages/boundary";
import { componentCount, roadChains } from "../../src/gen/geometry/graph";
import { contains, distanceToBoundary } from "../../src/gen/geometry/polygon";

const SEEDS = ["village", "hamlet", "riverford", "0", "zzz", "mistmoor"];

function degrees(net: RoadNetwork): Map<number, number> {
    const deg = new Map<number, number>();
    for (const n of net.nodes) deg.set(n.id, 0);
    for (const e of net.edges) {
        deg.set(e.a, deg.get(e.a)! + 1);
        deg.set(e.b, deg.get(e.b)! + 1);
    }
    return deg;
}

type Pt = { x: number; y: number };

/** True only if the two open segments cross transversally at an interior point.
 *  Uses the intersection parameters (not orientation signs), which stays robust
 *  for near-collinear segments; collinear/parallel pairs are not proper crossings. */
function crossesInterior(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
    const rx = a2.x - a1.x;
    const ry = a2.y - a1.y;
    const sx = b2.x - b1.x;
    const sy = b2.y - b1.y;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-9) return false; // parallel or collinear
    const qx = b1.x - a1.x;
    const qy = b1.y - a1.y;
    const ti = (qx * sy - qy * sx) / denom;
    const tj = (qx * ry - qy * rx) / denom;
    const EPS = 1e-6;
    return ti > EPS && ti < 1 - EPS && tj > EPS && tj < 1 - EPS;
}

function chainLength(points: Pt[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return total;
}

describe("road network invariants", () => {
    for (const seed of SEEDS) {
        it(`produces a connected planar network for seed "${seed}"`, () => {
            const model: MapModel = generateVillage(seed, { settlementProfile: "haufendorf" });
            const net = model.roads;
            const pos = new Map(net.nodes.map((n) => [n.id, n.pos]));

            expect(net.nodes.length).toBeGreaterThan(4);
            expect(net.edges.some((e) => e.kind === "primary")).toBe(true);

            // No zero-length edges.
            for (const e of net.edges) {
                const a = pos.get(e.a)!;
                const b = pos.get(e.b)!;
                expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-4);
            }

            // Single connected component.
            expect(componentCount(net)).toBe(1);
            // Planar: no two edges that don't share a node cross in their interiors.
            for (let i = 0; i < net.edges.length; i++) {
                for (let j = i + 1; j < net.edges.length; j++) {
                    const e1 = net.edges[i];
                    const e2 = net.edges[j];
                    if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue;
                    const cross = crossesInterior(pos.get(e1.a)!, pos.get(e1.b)!, pos.get(e2.a)!, pos.get(e2.b)!);
                    expect(cross, `edges ${i} and ${j} cross`).toBe(false);
                }
            }

            // A real network has several ordinary intersections, not every
            // primary converging into one oversized central roundabout.
            const junctionDegrees = [...degrees(net).values()].filter((degree) => degree >= 3);
            expect(junctionDegrees.length).toBeGreaterThanOrEqual(2);
            expect(Math.max(...junctionDegrees)).toBeLessThanOrEqual(5);

            // Junctions reserve enough road frontage for multiple lots between
            // them; otherwise adding a branch only creates unusable slivers.
            const junctions = net.nodes.filter((node) => degrees(net).get(node.id)! >= 3);
            for (let i = 0; i < junctions.length; i++) {
                for (let j = i + 1; j < junctions.length; j++) {
                    expect(Math.hypot(junctions[i].pos.x - junctions[j].pos.x, junctions[i].pos.y - junctions[j].pos.y)).toBeGreaterThanOrEqual(
                        DEFAULT_PARAMS.lotWidth * 2,
                    );
                }
            }

            // Lanes are dead-end frontage roads, so each must be long enough
            // for its intended lots. Secondary loop edges may be split at their
            // junctions during planarization and are therefore not tested alone.
            for (const chain of roadChains(net)) {
                if (chain.kind === "lane") expect(chainLength(chain.points)).toBeGreaterThanOrEqual(DEFAULT_PARAMS.lotWidth * 1.5);
            }

            // M6 approaches may leave the village, but every graph node remains
            // inside the surrounding map extent.
            for (const n of net.nodes) {
                const inside = insideBounds(model.mapBounds, n.pos);
                expect(inside, `node ${n.id} at ${n.pos.x},${n.pos.y}`).toBe(true);
            }
        });
    }
});

describe("approach roads", () => {
    for (const seed of ["village", "hamlet", "riverford", "tarry"]) {
        it(`connects ${seed} to map-edge entrances`, () => {
            const model = generateVillage(seed, { settlementProfile: "haufendorf" });
            const approaches = model.roads.edges.filter((edge) => edge.kind === "approach");
            const positions = new Map(model.roads.nodes.map((node) => [node.id, node.pos]));
            const degree = degrees(model.roads);
            const entrances = [...new Set(approaches.flatMap((edge) => [edge.a, edge.b]).filter((id) => onBounds(model.mapBounds, positions.get(id)!)))];

            expect(entrances.length).toBeGreaterThanOrEqual(model.params.approachRoadMin);
            expect(entrances.length).toBeLessThanOrEqual(model.params.approachRoadMax);
            for (const outerId of entrances) {
                const outer = positions.get(outerId)!;
                const connected = approachComponent(model.roads, outerId);
                const innerId = [...connected].find((id) => model.roads.edges.some(
                    (edge) => edge.kind === "primary" && (edge.a === id || edge.b === id),
                ));

                expect(onBounds(model.mapBounds, outer)).toBe(true);
                expect(innerId).toBeDefined();
                expect(degree.get(outerId)).toBe(1);
                expect(boundaryCrossings(model.boundary, positions.get(innerId!)!, outer)).toBe(1);
            }
        });
    }
});

it('can close local blocks with secondary connectors for seed "waxony"', () => {
    const net = generateVillage("waxony", { settlementProfile: "haufendorf" }).roads;
    expect(net.edges.length - net.nodes.length + componentCount(net)).toBeGreaterThanOrEqual(1);
});

it('keeps secondary roads connected at both ends for seed "tarry"', () => {
    const net = generateVillage("tarry", { settlementProfile: "haufendorf" }).roads;
    const degree = degrees(net);
    const secondaryEdges = net.edges.filter((edge) => edge.kind === "secondary");
    expect(secondaryEdges.length).toBeGreaterThan(0);
    for (const edge of secondaryEdges) {
        expect(degree.get(edge.a)!).toBeGreaterThanOrEqual(2);
        expect(degree.get(edge.b)!).toBeGreaterThanOrEqual(2);
    }
    expect(net.edges.length - net.nodes.length + componentCount(net)).toBeGreaterThanOrEqual(1);
});

describe("road determinism and stream isolation", () => {
    it("is identical for the same seed", () => {
        expect(generateVillage("village").roads).toEqual(generateVillage("village").roads);
    });

    it("differs for different seeds", () => {
        expect(generateVillage("village").roads).not.toEqual(generateVillage("hamlet").roads);
    });

    it("does not perturb the boundary stream", () => {
        const model = generateVillage("village");
        const boundary = generateBoundary(createRng("village").stream("boundary"), {
            radius: DEFAULT_PARAMS.radius,
            points: DEFAULT_PARAMS.boundaryPoints,
            irregularity: DEFAULT_PARAMS.boundaryIrregularity,
        });
        expect(model.boundary).toEqual(boundary);
    });
});

function insideBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, point: Pt): boolean {
    const eps = 1e-6;
    return point.x >= bounds.minX - eps && point.x <= bounds.maxX + eps && point.y >= bounds.minY - eps && point.y <= bounds.maxY + eps;
}

function onBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, point: Pt): boolean {
    const eps = 1e-6;
    return Math.abs(point.x - bounds.minX) < eps || Math.abs(point.x - bounds.maxX) < eps || Math.abs(point.y - bounds.minY) < eps || Math.abs(point.y - bounds.maxY) < eps;
}

function approachComponent(network: RoadNetwork, start: number): Set<number> {
    const connected = new Set<number>([start]);
    const pending = [start];
    while (pending.length > 0) {
        const current = pending.pop()!;
        for (const edge of network.edges) {
            if (edge.kind !== "approach" || (edge.a !== current && edge.b !== current)) continue;
            const next = edge.a === current ? edge.b : edge.a;
            if (connected.has(next)) continue;
            connected.add(next);
            pending.push(next);
        }
    }
    return connected;
}

function boundaryCrossings(boundary: Pt[], a: Pt, b: Pt): number {
    let crossings = 0;
    for (let i = 0; i < boundary.length; i++) {
        const hit = segmentIntersection(a, b, boundary[i], boundary[(i + 1) % boundary.length]);
        if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6) crossings++;
    }
    return crossings;
}

function segmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt): { t: number } | null {
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-9) return null;
    const qx = c.x - a.x;
    const qy = c.y - a.y;
    const t = (qx * sy - qy * sx) / denom;
    const u = (qx * ry - qy * rx) / denom;
    return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? { t } : null;
}
