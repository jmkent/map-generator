import { describe, expect, it } from "vitest";

import type { MapModel, RoadNetwork } from "../../src/gen/types";
import { generateVillage, DEFAULT_PARAMS } from "../../src/gen/pipeline";
import { createRng } from "../../src/gen/rng";
import { generateBoundary } from "../../src/gen/stages/boundary";
import { contains, distanceToBoundary } from "../../src/gen/geometry/polygon";

const SEEDS = ["village", "hamlet", "riverford", "0", "zzz", "mistmoor"];

function adjacency(net: RoadNetwork): Map<number, number[]> {
    const adj = new Map<number, number[]>();
    for (const n of net.nodes) adj.set(n.id, []);
    for (const e of net.edges) {
        adj.get(e.a)!.push(e.b);
        adj.get(e.b)!.push(e.a);
    }
    return adj;
}

function isConnected(net: RoadNetwork): boolean {
    if (net.nodes.length === 0) return false;
    const adj = adjacency(net);
    const seen = new Set<number>([net.nodes[0].id]);
    const stack = [net.nodes[0].id];
    while (stack.length) {
        for (const next of adj.get(stack.pop()!)!) {
            if (!seen.has(next)) {
                seen.add(next);
                stack.push(next);
            }
        }
    }
    return seen.size === net.nodes.length;
}

function posById(net: RoadNetwork) {
    return new Map(net.nodes.map((n) => [n.id, n.pos]));
}

describe("road network invariants", () => {
    for (const seed of SEEDS) {
        it(`produces a valid network for seed "${seed}"`, () => {
            const model: MapModel = generateVillage(seed);
            const net = model.roads;
            const pos = posById(net);

            expect(net.nodes.length).toBeGreaterThan(2);
            expect(net.edges.some((e) => e.kind === "main")).toBe(true);

            // No zero-length edges.
            for (const e of net.edges) {
                const a = pos.get(e.a)!;
                const b = pos.get(e.b)!;
                expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-4);
            }

            // Connected graph.
            expect(isConnected(net)).toBe(true);

            // Every branch attaches to a main-street node.
            const mainNodeIds = new Set<number>();
            for (const e of net.edges) {
                if (e.kind === "main") {
                    mainNodeIds.add(e.a);
                    mainNodeIds.add(e.b);
                }
            }
            for (const e of net.edges) {
                if (e.kind === "branch") {
                    expect(mainNodeIds.has(e.a) || mainNodeIds.has(e.b)).toBe(true);
                }
            }

            // All road nodes lie inside the boundary (tiny tolerance for FP).
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
        // The boundary must be exactly what its own stream produces, proving the
        // roads stage draws from an isolated stream (PLAN.md §5).
        const model = generateVillage("village");
        const boundary = generateBoundary(createRng("village").stream("boundary"), {
            radius: DEFAULT_PARAMS.radius,
            points: DEFAULT_PARAMS.boundaryPoints,
            irregularity: DEFAULT_PARAMS.boundaryIrregularity,
        });
        expect(model.boundary).toEqual(boundary);
    });
});
