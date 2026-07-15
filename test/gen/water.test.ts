import { describe, expect, it } from "vitest";

import type { Vec2 } from "../../src/gen/types";
import { generateVillage } from "../../src/gen/pipeline";
import { convexOverlap, ensureCCW } from "../../src/gen/geometry/polygon";
import { add, normalize, perp, scale, sub } from "../../src/gen/geometry/vec2";
import { distanceToRiver } from "../../src/gen/stages/water";

const SEEDS = ["village", "hamlet", "riverford", "tarry"];

describe("structural rivers", () => {
    for (const seed of SEEDS) {
        it(`spans map edges and marks every road crossing for ${seed}`, () => {
            const model = generateVillage(seed, { settlementProfile: "haufendorf" });
            const river = model.water[0];
            const start = river.path[0];
            const end = river.path[river.path.length - 1];

            expect(river.kind).toBe("river");
            expect(onBounds(model.mapBounds, start)).toBe(true);
            expect(onBounds(model.mapBounds, end)).toBe(true);
            expect(simplePolyline(river.path)).toBe(true);

            const positions = new Map(model.roads.nodes.map((node) => [node.id, node.pos]));
            for (const edge of model.roads.edges) {
                const a = positions.get(edge.a)!;
                const b = positions.get(edge.b)!;
                for (let i = 1; i < river.path.length; i++) {
                    const hit = segmentIntersection(a, b, river.path[i - 1], river.path[i]);
                    if (!hit) continue;
                    const aBridge = model.roads.nodes[edge.a].crossing === "bridge" && close(a, hit);
                    const bBridge = model.roads.nodes[edge.b].crossing === "bridge" && close(b, hit);
                    expect(aBridge || bBridge, `road edge ${edge.a}-${edge.b} crosses without bridge node`).toBe(true);
                    expect(edge.crossing).toBe("bridge");
                }
            }
        });
    }

    it("keeps buildings clear of the channel and biases development toward banks", () => {
        const model = generateVillage("river-banks", { settlementProfile: "haufendorf" });
        const river = model.water[0];
        const distances = model.buildings.map((building) => distanceToRiver(building.center, river));

        expect(distances.every((distance) => distance >= river.width / 2)).toBe(true);
        for (const building of model.buildings) {
            for (let i = 1; i < river.path.length; i++) {
                expect(convexOverlap(building.footprint, channelSegment(river.path[i - 1], river.path[i], river.width), 0.01)).toBe(false);
            }
        }
        const nearBanks = distances.filter((distance) => distance < 55).length;
        expect(nearBanks / distances.length).toBeGreaterThan(0.2);
    });

    it("is deterministic on its named stream", () => {
        expect(generateVillage("river-stream").water).toEqual(generateVillage("river-stream").water);
        expect(generateVillage("river-stream", { primaryRoadTarget: 1 }).water).toEqual(generateVillage("river-stream").water);
    });
});

function onBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, point: Vec2): boolean {
    const eps = 1e-6;
    return Math.abs(point.x - bounds.minX) < eps || Math.abs(point.x - bounds.maxX) < eps || Math.abs(point.y - bounds.minY) < eps || Math.abs(point.y - bounds.maxY) < eps;
}

function simplePolyline(points: Vec2[]): boolean {
    for (let i = 1; i < points.length; i++) {
        for (let j = i + 2; j < points.length; j++) {
            if (i === 1 && j === points.length - 1) continue;
            if (segmentIntersection(points[i - 1], points[i], points[j - 1], points[j])) return false;
        }
    }
    return true;
}

function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
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
    return t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? { x: a.x + rx * t, y: a.y + ry * t } : null;
}

function close(a: Vec2, b: Vec2): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) < 1e-5;
}

function channelSegment(a: Vec2, b: Vec2, width: number): Vec2[] {
    const offset = scale(normalize(perp(sub(b, a))), width / 2);
    return ensureCCW([sub(a, offset), add(a, offset), add(b, offset), sub(b, offset)]);
}
