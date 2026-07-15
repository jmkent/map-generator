import { describe, expect, it } from "vitest";

import type { MapModel, RoadNetwork } from "../../src/gen/types";
import { generateVillage, DEFAULT_PARAMS } from "../../src/gen/pipeline";
import { createRng } from "../../src/gen/rng";
import { generateBoundary } from "../../src/gen/stages/boundary";
import { componentCount } from "../../src/gen/geometry/graph";
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

describe("road network invariants", () => {
    for (const seed of SEEDS) {
        it(`produces a connected planar network for seed "${seed}"`, () => {
            const model: MapModel = generateVillage(seed);
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

            // Every node lies inside the boundary (tiny tolerance for FP).
            for (const n of net.nodes) {
                const inside = contains(model.boundary, n.pos) || distanceToBoundary(model.boundary, n.pos) < 1e-6;
                expect(inside, `node ${n.id} at ${n.pos.x},${n.pos.y}`).toBe(true);
            }
        });
    }
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
