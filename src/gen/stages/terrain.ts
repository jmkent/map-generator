// Terrain-first local landscape generation. PURE.

import type { Bounds, ResolvedTerrainProfile, TerrainModel, TerrainProfile, TerrainSample, Vec2 } from "../types";
import type { Rng } from "../rng";
import { clamp } from "../geometry/scalar";

export interface TerrainParams {
    radius: number;
    profile: TerrainProfile;
}

const PROFILES: ResolvedTerrainProfile[] = ["plain", "river-valley", "lakeshore", "coast", "cove", "peninsula", "ridge", "hillside", "island"];
const RESOLUTION = 65;

/** Generate a visible, analytical landscape roughly three village diameters wide. */
export function generateTerrain(rng: Rng, params: TerrainParams): TerrainModel {
    const profile = params.profile === "auto" ? rng.pick(PROFILES) : params.profile;
    const extent = params.radius * 3;
    const bounds = { minX: -extent, minY: -extent, maxX: extent, maxY: extent };
    const seaLevel = 0;
    const phaseA = rng.float(0, Math.PI * 2);
    const phaseB = rng.float(0, Math.PI * 2);
    const samples: TerrainSample[] = [];
    for (let y = 0; y < RESOLUTION; y++) {
        for (let x = 0; x < RESOLUTION; x++) {
            const point = gridPoint(bounds, RESOLUTION, x, y);
            const height = terrainHeight(profile, point, params.radius, phaseA, phaseB);
            const slope = estimateSlope(profile, point, params.radius, phaseA, phaseB);
            const land = height > seaLevel;
            samples.push({ height, slope, land, buildable: land && slope < 0.22 && height > 1.5 });
        }
    }
    return { profile, bounds, resolution: RESOLUTION, seaLevel, samples, hydrology: [] };
}

/** Read a terrain sample with clamped grid coordinates. */
export function terrainSampleAt(terrain: TerrainModel, point: Vec2): TerrainSample {
    const tx = clamp(Math.round((point.x - terrain.bounds.minX) / (terrain.bounds.maxX - terrain.bounds.minX) * (terrain.resolution - 1)), 0, terrain.resolution - 1);
    const ty = clamp(Math.round((point.y - terrain.bounds.minY) / (terrain.bounds.maxY - terrain.bounds.minY) * (terrain.resolution - 1)), 0, terrain.resolution - 1);
    return terrain.samples[ty * terrain.resolution + tx];
}

function terrainHeight(profile: ResolvedTerrainProfile, p: Vec2, radius: number, a: number, b: number): number {
    const x = p.x / radius;
    const y = p.y / radius;
    const noise = Math.sin(x * 1.7 + a) * 3 + Math.cos(y * 1.3 + b) * 2;
    if (profile === "plain") return 14 + noise * 0.35;
    if (profile === "river-valley") return 14 + Math.abs(x) * 10 + noise - Math.max(0, 7 - Math.abs(x) * 7);
    if (profile === "lakeshore") return 12 + y * 8 + noise - Math.max(0, -y * 16);
    if (profile === "coast") return 12 + y * 10 + noise - Math.max(0, -y * 18);
    if (profile === "cove") return 13 + y * 10 + noise - Math.max(0, 14 - Math.hypot(x, y + 1.45) * 13);
    if (profile === "peninsula") return 13 + y * 4 + noise - Math.max(0, Math.abs(x) * 13 + -y * 8 - 9);
    if (profile === "ridge") return 10 + Math.exp(-x * x * 1.5) * 28 + noise;
    if (profile === "hillside") return 12 + (x + y) * 8 + noise;
    return 22 - Math.hypot(x, y) * 13 + noise;
}

function estimateSlope(profile: ResolvedTerrainProfile, p: Vec2, radius: number, a: number, b: number): number {
    const step = radius * 0.04;
    const dx = terrainHeight(profile, { x: p.x + step, y: p.y }, radius, a, b) - terrainHeight(profile, { x: p.x - step, y: p.y }, radius, a, b);
    const dy = terrainHeight(profile, { x: p.x, y: p.y + step }, radius, a, b) - terrainHeight(profile, { x: p.x, y: p.y - step }, radius, a, b);
    return Math.hypot(dx, dy) / (step * 2);
}

/** Map integer grid coordinates (which may fall one step outside) to world space. */
export function gridPoint(bounds: Bounds, resolution: number, x: number, y: number): Vec2 {
    return { x: bounds.minX + (bounds.maxX - bounds.minX) * x / (resolution - 1), y: bounds.minY + (bounds.maxY - bounds.minY) * y / (resolution - 1) };
}
