// Terrain-constrained settlement siting. PURE.

import type { SettlementSite, TerrainModel, Vec2 } from "../types";
import type { Rng } from "../rng";

export interface SiteParams {
    terrain: TerrainModel;
    radius: number;
}

/** Choose a stable anchor from the largest connected buildable terrain component. */
export function selectSettlementSite(rng: Rng, params: SiteParams): SettlementSite {
    const { terrain, radius } = params;
    const components = buildableComponents(terrain);
    const largest = components.sort((a, b) => b.length - a.length)[0] ?? [];
    const center = { x: (terrain.bounds.minX + terrain.bounds.maxX) / 2, y: (terrain.bounds.minY + terrain.bounds.maxY) / 2 };
    let best: { index: number; score: number } | undefined;
    for (const index of largest) {
        const sample = terrain.samples[index];
        const point = pointAt(terrain, index);
        const distance = Math.hypot(point.x - center.x, point.y - center.y);
        const centerScore = Math.max(0, 1 - distance / (radius * 2.3));
        const score = centerScore * 0.65 + (1 - sample.slope / 0.22) * 0.35 + rng.float(-0.025, 0.025);
        if (!best || score > best.score) best = { index, score };
    }
    const anchor = best ? pointAt(terrain, best.index) : center;
    return {
        anchor,
        componentSize: largest.length,
        suitability: Math.max(0, best?.score ?? 0),
        rationale: `${terrain.profile} site on stable connected land`,
    };
}

function buildableComponents(terrain: TerrainModel): number[][] {
    const seen = new Set<number>();
    const components: number[][] = [];
    const { resolution, samples } = terrain;
    for (let start = 0; start < samples.length; start++) {
        if (seen.has(start) || !samples[start].buildable) continue;
        const component: number[] = [];
        const pending = [start];
        seen.add(start);
        while (pending.length > 0) {
            const current = pending.pop()!;
            component.push(current);
            for (const next of [current - 1, current + 1, current - resolution, current + resolution]) {
                const nx = next % resolution;
                const ny = Math.floor(next / resolution);
                if (next < 0 || next >= samples.length || nx < 0 || nx >= resolution || ny < 0 || ny >= resolution || seen.has(next) || !samples[next].buildable) continue;
                seen.add(next);
                pending.push(next);
            }
        }
        components.push(component);
    }
    return components;
}

function pointAt(terrain: TerrainModel, index: number): Vec2 {
    const x = index % terrain.resolution;
    const y = Math.floor(index / terrain.resolution);
    return {
        x: terrain.bounds.minX + (terrain.bounds.maxX - terrain.bounds.minX) * x / (terrain.resolution - 1),
        y: terrain.bounds.minY + (terrain.bounds.maxY - terrain.bounds.minY) * y / (terrain.resolution - 1),
    };
}
