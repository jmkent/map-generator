// Regular-grid terrain mesher. PURE.
//
// The elevation gradient is rendered as a stack of flat-colored meshes, one per
// elevation band (lite's StandardMaterial has no per-vertex color or straightforward
// vertex-textured path). Each grid cell joins the band of its average height, so the
// union of band meshes is the full raised terrain with no gaps. The SVG renderer
// bands the same ramp; here the color comes from a flat material, not the geometry.

import type { Bounds, TerrainModel, TerrainSample } from "../../gen/types";
import { gridPoint } from "../../gen/stages/terrain";
import { clamp } from "../../gen/geometry/scalar";
import { heightColorHex } from "../palette";
import type { GeometryData } from "../geometryData";

/** Keep terrain clear of the renderer's ground-plane depth cutoff. */
export const TERRAIN_BASE_Y = 0.8;

/** A raised terrain surface split into flat-colored elevation bands. */
export function terrainBandMeshes(terrain: TerrainModel, bands = 18, verticalScale = 0.002, baseY = TERRAIN_BASE_Y): Array<{ color: string; geometry: GeometryData }> {
    const { resolution, samples, bounds, seaLevel } = terrain;
    const { min, max } = heightRange(samples);
    const span = max - min || 1;
    const positions: number[][] = Array.from({ length: bands }, () => []);
    const indices: number[][] = Array.from({ length: bands }, () => []);
    const vertices: Array<Map<number, number>> = Array.from({ length: bands }, () => new Map());

    for (let y = 0; y < resolution - 1; y++) {
        for (let x = 0; x < resolution - 1; x++) {
            const corners = [y * resolution + x, y * resolution + x + 1, (y + 1) * resolution + x + 1, (y + 1) * resolution + x]; // TL, TR, BR, BL
            const avg = corners.reduce((sum, ci) => sum + samples[ci].height, 0) / 4;
            const band = clamp(Math.floor((avg - min) / span * bands), 0, bands - 1);
            const verts = positions[band];
            const local = corners.map((ci) => {
                const existing = vertices[band].get(ci);
                if (existing !== undefined) return existing;
                const world = gridPoint(bounds, resolution, ci % resolution, Math.floor(ci / resolution));
                const index = verts.length / 3;
                verts.push(world.x, baseY + samples[ci].height * verticalScale, world.y);
                vertices[band].set(ci, index);
                return index;
            });
            // Match Lite's ground-mesh diagonal and front-face order after mapping
            // generation (x,y) to world (x,z); normals remain +Y for lighting.
            indices[band].push(local[1], local[2], local[3], local[0], local[1], local[3]);
        }
    }

    const meshes: Array<{ color: string; geometry: GeometryData }> = [];
    for (let band = 0; band < bands; band++) {
        if (positions[band].length === 0) continue;
        const pos = new Float32Array(positions[band]);
        const normals = new Float32Array(pos.length);
        for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
        const color = heightColorHex(min + (band + 0.5) / bands * span, seaLevel, min, max);
        meshes.push({ color, geometry: { positions: pos, normals, indices: new Uint32Array(indices[band]) } });
    }
    return meshes;
}

function heightRange(samples: readonly TerrainSample[]): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const sample of samples) {
        if (sample.height < min) min = sample.height;
        if (sample.height > max) max = sample.height;
    }
    return { min, max };
}

/** A solid rectangular border ribbon around the map extent, on the y-plane — the
 *  3D counterpart of the SVG map frame. */
export function mapFrameGeometry(bounds: Bounds, width: number, y = 0): GeometryData {
    const { minX, minY, maxX, maxY } = bounds;
    const o = width;
    // Four strips (top, bottom, left, right) as quads, framing the bounds outline.
    const quads: Array<[number, number, number, number]> = [
        [minX - o, maxY, maxX + o, maxY + o], // top
        [minX - o, minY - o, maxX + o, minY], // bottom
        [minX - o, minY, minX, maxY], // left
        [maxX, minY, maxX + o, maxY], // right
    ];
    const positions = new Float32Array(quads.length * 4 * 3);
    const normals = new Float32Array(quads.length * 4 * 3);
    const indices = new Uint32Array(quads.length * 6);
    quads.forEach(([x0, z0, x1, z1], q) => {
        const corners: Array<[number, number]> = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
        const base = q * 4;
        corners.forEach(([cx, cz], c) => {
            const offset = (base + c) * 3;
            positions[offset] = cx;
            positions[offset + 1] = y;
            positions[offset + 2] = cz;
            normals[offset + 1] = 1;
        });
        const io = q * 6;
        indices[io] = base + 1;
        indices[io + 1] = base + 3;
        indices[io + 2] = base + 2;
        indices[io + 3] = base;
        indices[io + 4] = base + 1;
        indices[io + 5] = base + 2;
    });
    return { positions, normals, indices };
}
