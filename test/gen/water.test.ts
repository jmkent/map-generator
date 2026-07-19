import { describe, expect, it } from "vitest";

import type { Vec2 } from "../../src/gen/types";
import { generateVillage } from "../../src/gen/pipeline";
import { contains, convexOverlap, ensureCCW, polygonsOverlap } from "../../src/gen/geometry/polygon";
import { add, normalize, perp, scale, sub } from "../../src/gen/geometry/vec2";
import { distanceToRiver } from "../../src/gen/stages/water";

const SEEDS = ["village", "hamlet", "riverford", "tarry"];

describe("structural rivers", () => {
    for (const seed of SEEDS) {
        it(`spans map edges and marks every road crossing for ${seed}`, () => {
            const model = generateVillage(seed, { settlementProfile: "haufendorf", riverChance: 1 });
            const river = model.water[0];
            const start = river.path[0];
            const end = river.path[river.path.length - 1];

            expect(river.kind).toBe("river");
            expect(river.leftBank).toHaveLength(river.path.length);
            expect(river.rightBank).toHaveLength(river.path.length);
            expect(onBounds(model.mapBounds, start)).toBe(true);
            expect(onBounds(model.mapBounds, end)).toBe(true);
            expect(simplePolyline(river.path)).toBe(true);
            expect(river.path.some((point) => contains(model.boundary, point))).toBe(true);

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
        const model = generateVillage("river-banks", { settlementProfile: "haufendorf", riverChance: 1 });
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
        expect(generateVillage("river-stream", { riverChance: 1 }).water[0]).toEqual(generateVillage("river-stream", { riverChance: 1 }).water[0]);
        expect(generateVillage("river-stream", { riverChance: 1, primaryRoadTarget: 1 }).water[0]).toEqual(generateVillage("river-stream", { riverChance: 1 }).water[0]);
    });

    it("uses variable-width, noisy river banks", () => {
        const river = generateVillage("noisy-river", { riverChance: 1 }).water[0];
        if (river.kind !== "river") return;
        const widths = river.path.map((_, index) => Math.hypot(
            river.leftBank[index].x - river.rightBank[index].x,
            river.leftBank[index].y - river.rightBank[index].y,
        ));

        expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(0.3);
    });
});

it("makes river presence a deterministic optional seed decision", () => {
    expect(generateVillage("optional-river", { riverChance: 0 }).water.some((body) => body.kind === "river")).toBe(false);
    expect(generateVillage("optional-river", { riverChance: 1 }).water.some((body) => body.kind === "river")).toBe(true);
});

describe("standing water and coastline", () => {
    for (const kind of ["pond", "lake", "coast"] as const) {
        it(`generates a constrained ${kind}`, () => {
            const model = generateVillage(`standing-${kind}`, { settlementProfile: "haufendorf", standingWaterKind: kind });
            const body = model.water.find((water) => water.kind === kind);
            expect(body).toBeDefined();
            if (!body || body.kind === "river") return;

            expect(simplePolygon(body.polygon)).toBe(true);
            expect(body.polygon.every((point) => insideBounds(model.mapBounds, point))).toBe(true);
            if (kind === "coast") {
                expect(body.polygon.some((point) => onBounds(model.mapBounds, point))).toBe(true);
                expect(body.polygon.length).toBeGreaterThan(4);
            }

            const positions = new Map(model.roads.nodes.map((node) => [node.id, node.pos]));
            for (const edge of model.roads.edges) {
                expect(segmentOverlapsPolygon(positions.get(edge.a)!, positions.get(edge.b)!, body.polygon)).toBe(false);
            }
            for (const building of model.buildings) {
                // Coastlines can be concave, so use the general overlap test.
                expect(polygonsOverlap(building.footprint, body.polygon)).toBe(false);
            }
        });
    }

    it("honors and deterministically resolves standing-water selection", () => {
        expect(generateVillage("standing-auto").water).toEqual(generateVillage("standing-auto").water);
        expect(generateVillage("standing-lake", { standingWaterKind: "lake" }).water.some((body) => body.kind === "lake")).toBe(true);
    });
});

describe("terrain-derived hydrology (M12c)", () => {
    for (const profile of ["coast", "cove", "peninsula"] as const) {
        it(`traces the ${profile} shoreline from the height field`, () => {
            const model = generateVillage(`m12c-${profile}`, { settlementProfile: "haufendorf", terrainProfile: profile });
            const coast = model.water.find((body) => body.kind === "coast");
            expect(coast, "expected a coast body").toBeDefined();
            if (!coast || coast.kind !== "coast") return;

            // A traced shoreline is detailed and reaches the map edge, unlike the
            // old ~15-point heuristic strip.
            expect(coast.polygon.length).toBeGreaterThan(20);
            expect(coast.polygon.some((point) => onBounds(model.mapBounds, point))).toBe(true);

            // The polygon agrees with the terrain's own land/sea mask: most grid
            // cells inside the polygon are below sea level, and vice versa.
            const terrain = model.terrain;
            const { minX, minY, maxX, maxY } = terrain.bounds;
            let agree = 0;
            let total = 0;
            for (let row = 0; row < terrain.resolution; row++) {
                for (let col = 0; col < terrain.resolution; col++) {
                    const point = {
                        x: minX + (maxX - minX) * col / (terrain.resolution - 1),
                        y: minY + (maxY - minY) * row / (terrain.resolution - 1),
                    };
                    const sea = !terrain.samples[row * terrain.resolution + col].land;
                    if (contains(coast.polygon, point) === sea) agree++;
                    total++;
                }
            }
            expect(agree / total).toBeGreaterThan(0.9);
        });
    }

    it("traces an island's ring sea as a coast with a land hole (M12d)", () => {
        const model = generateVillage("m12d-island", { settlementProfile: "haufendorf", terrainProfile: "island" });
        const coast = model.water.find((body) => body.kind === "coast");
        expect(coast, "expected a coast body").toBeDefined();
        if (!coast || coast.kind !== "coast") return;

        // The surrounding sea is a ring: an outer polygon with the island as a hole.
        expect(coast.holes && coast.holes.length).toBeGreaterThanOrEqual(1);

        // The island's land survives (not flooded by the outer polygon) and stays
        // buildable, and the settlement actually occupies it.
        expect(model.terrain.samples.some((sample) => sample.land && sample.buildable)).toBe(true);
        expect(model.buildings.length).toBeGreaterThan(0);

        // Sea/land mask agrees with the polygon-minus-holes over the whole grid.
        const terrain = model.terrain;
        const { minX, minY, maxX, maxY } = terrain.bounds;
        const inSea = (p: Vec2): boolean => contains(coast.polygon, p) && !(coast.holes ?? []).some((hole) => contains(hole, p));
        let agree = 0;
        for (let row = 0; row < terrain.resolution; row++) {
            for (let col = 0; col < terrain.resolution; col++) {
                const point = {
                    x: minX + (maxX - minX) * col / (terrain.resolution - 1),
                    y: minY + (maxY - minY) * row / (terrain.resolution - 1),
                };
                if (inSea(point) === !terrain.samples[row * terrain.resolution + col].land) agree++;
            }
        }
        expect(agree / terrain.resolution ** 2).toBeGreaterThan(0.9);
    });

    it("widens a river from source to mouth", () => {
        const model = generateVillage("valley-flow", { settlementProfile: "haufendorf", terrainProfile: "river-valley", riverChance: 1 });
        const river = model.water.find((body) => body.kind === "river");
        expect(river).toBeDefined();
        if (!river || river.kind !== "river") return;

        const widths = river.leftBank.map((left, i) => Math.hypot(left.x - river.rightBank[i].x, left.y - river.rightBank[i].y));
        // Pronounced downstream widening, not a near-uniform channel.
        expect(Math.max(...widths) / Math.min(...widths)).toBeGreaterThan(2.5);

        // The wide end sits on lower ground than the narrow end.
        const heightAt = (p: Vec2): number => {
            const t = model.terrain;
            const cx = Math.round((p.x - t.bounds.minX) / (t.bounds.maxX - t.bounds.minX) * (t.resolution - 1));
            const cy = Math.round((p.y - t.bounds.minY) / (t.bounds.maxY - t.bounds.minY) * (t.resolution - 1));
            return t.samples[cy * t.resolution + cx].height;
        };
        const startWide = widths[0] > widths[widths.length - 1];
        const mouth = startWide ? river.path[0] : river.path[river.path.length - 1];
        const source = startWide ? river.path[river.path.length - 1] : river.path[0];
        expect(heightAt(mouth)).toBeLessThanOrEqual(heightAt(source));
    });
});

function onBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, point: Vec2): boolean {
    const eps = 1e-6;
    return Math.abs(point.x - bounds.minX) < eps || Math.abs(point.x - bounds.maxX) < eps || Math.abs(point.y - bounds.minY) < eps || Math.abs(point.y - bounds.maxY) < eps;
}

function insideBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, point: Vec2): boolean {
    const eps = 1e-6;
    return point.x >= bounds.minX - eps && point.x <= bounds.maxX + eps && point.y >= bounds.minY - eps && point.y <= bounds.maxY + eps;
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

function simplePolygon(points: Vec2[]): boolean {
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            if (j === i || (j + 1) % points.length === i || (i + 1) % points.length === j) continue;
            if (segmentIntersection(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return false;
        }
    }
    return true;
}

function segmentOverlapsPolygon(a: Vec2, b: Vec2, polygon: Vec2[]): boolean {
    if (polygon.some((point) => pointOnSegment(point, a, b))) return true;
    for (let i = 0; i < polygon.length; i++) {
        if (segmentIntersection(a, b, polygon[i], polygon[(i + 1) % polygon.length])) return true;
    }
    return false;
}

function pointOnSegment(point: Vec2, a: Vec2, b: Vec2): boolean {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / (abx * abx + aby * aby);
    if (t < 0 || t > 1) return false;
    return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t)) < 1e-6;
}

function channelSegment(a: Vec2, b: Vec2, width: number): Vec2[] {
    const offset = scale(normalize(perp(sub(b, a))), width / 2);
    return ensureCCW([sub(a, offset), add(a, offset), add(b, offset), sub(b, offset)]);
}
