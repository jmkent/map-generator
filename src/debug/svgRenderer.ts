// Headless SVG renderer for a MapModel. Mirrors the Babylon renderer's data so
// generation can be developed and golden-tested without a browser (PLAN.md §1).
// Output is a deterministic string: coordinates are rounded so snapshots are
// stable across platforms.

import type { MapModel, StandingWater } from "../gen/types";
import { boundsSize } from "../gen/types";
import { isoContours, type ContourGrid } from "../gen/geometry/contour";
import { gridPoint } from "../gen/stages/terrain";
import { BACKGROUND, COLORS, MAP_FRAME, elevationBands } from "../render/palette";

export interface SvgOptions {
    /** Empty margin around the map bounds, world units. */
    padding?: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

export function renderModelSvg(model: MapModel, opts: SvgOptions = {}): string {
    const padding = opts.padding ?? 30;
    const { mapBounds: bounds } = model;
    const { width, height } = boundsSize(bounds);
    const w = round(width + padding * 2);
    const h = round(height + padding * 2);

    // Map generation (x, y) to SVG space: shift bounds to the padded origin and
    // flip y so larger generation-y renders toward the top.
    const tx = (x: number): number => round(x - bounds.minX + padding);
    const ty = (y: number): number => round(bounds.maxY - y + padding);
    const ring = (poly: { x: number; y: number }[]) => poly.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ");
    const subpath = (poly: { x: number; y: number }[]) => `M ${poly.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" L ")} Z`;

    // The map rect covers exactly the terrain extent (= mapBounds).
    const mapX = tx(bounds.minX);
    const mapY = ty(bounds.maxY);
    const mapW = round(width);
    const mapH = round(height);

    const points = model.boundary.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ");

    const posById = new Map(model.roads.nodes.map((n) => [n.id, n.pos]));
    const roadLines = model.roads.edges.map((e) => {
        const a = posById.get(e.a);
        const b = posById.get(e.b);
        if (!a || !b) return "";
        const color = e.kind === "primary" || e.kind === "approach" ? COLORS.roadPrimary
            : e.kind === "secondary" ? COLORS.roadSecondary
            : e.kind === "lane" ? COLORS.roadLane : COLORS.roadTrack;
        return `  <line x1="${tx(a.x)}" y1="${ty(a.y)}" x2="${tx(b.x)}" y2="${ty(b.y)}" stroke="${color}" stroke-width="${round(e.width)}" stroke-linecap="round"/>`;
    });

    const civicPolys = model.civicSpaces.map(
        (space) => `  <polygon points="${ring(space.polygon)}" fill="${COLORS.civicFill}" stroke="${COLORS.civicStroke}" stroke-width="0.5"/>`,
    );
    // Rivers (surface water on land) and closed ponds/lakes draw flat on top of the
    // relief. The coast (the sea) is left to the elevation bands, which already show
    // it with a depth gradient — drawing it flat would overwrite that.
    const waterLines = model.water.flatMap((body) => body.kind === "river"
        ? [`  <polygon points="${ring([...body.leftBank, ...[...body.rightBank].reverse()])}" fill="${COLORS.water}" stroke="${COLORS.waterStroke}" stroke-width="0.5"/>`]
        : []);
    const waterPolys = model.water
        .filter((body): body is StandingWater => body.kind === "pond" || body.kind === "lake")
        .map((body) => `  <polygon points="${ring(body.polygon)}" fill="${COLORS.water}" stroke="${COLORS.waterStroke}" stroke-width="0.5"/>`);

    const parcelPolys = model.parcels.map(
        (p) => `  <polygon points="${ring(p.polygon)}" fill="none" stroke="${COLORS.parcelStroke}" stroke-width="0.4"/>`,
    );
    const buildingPolys = model.buildings.map(
        (b) => `  <polygon points="${ring(b.footprint)}" fill="${COLORS.buildingFill}" stroke="${COLORS.buildingStroke}" stroke-width="0.4"/>`,
    );

    // Hypsometric elevation bands: fill the map with the peak color, then paint the
    // region below each contour level (highest first) via marching squares.
    const terrain = model.terrain;
    const heights = terrain.samples.map((sample) => sample.height);
    let min = Infinity;
    let max = -Infinity;
    for (const height of heights) {
        if (height < min) min = height;
        if (height > max) max = height;
    }
    const grid: ContourGrid = {
        values: heights,
        cols: terrain.resolution,
        rows: terrain.resolution,
        toWorld: (col, row) => gridPoint(terrain.bounds, terrain.resolution, col, row),
    };
    const { base, layers } = elevationBands(min, max, terrain.seaLevel);
    const bandLayer = [`  <rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" fill="${base}"/>`];
    for (const { level, hex } of layers) {
        const loops = isoContours(grid, level);
        if (loops.length === 0) continue;
        bandLayer.push(`  <path d="${loops.map(subpath).join(" ")}" fill-rule="evenodd" fill="${hex}"/>`);
    }

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
        `  <defs><clipPath id="map"><rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}"/></clipPath></defs>`,
        // Non-map field of view, then the terrain relief clipped to the map extent.
        `  <rect width="${w}" height="${h}" fill="${BACKGROUND}"/>`,
        `  <g clip-path="url(#map)">`,
        ...bandLayer,
        `  </g>`,
        // The village extent is a dashed outline over the relief.
        `  <polygon points="${points}" fill="none" stroke="${COLORS.boundary}" stroke-width="1" stroke-dasharray="5 4" stroke-linejoin="round"/>`,
        ...civicPolys,
        ...waterLines,
        ...waterPolys,
        ...roadLines,
        ...parcelPolys,
        ...buildingPolys,
        // A clear frame around the map, drawn last so nothing overlaps its edge.
        `  <rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" fill="none" stroke="${MAP_FRAME}" stroke-width="1.5"/>`,
        `</svg>`,
        ``,
    ].join("\n");
}
