// Headless SVG renderer for a MapModel. Mirrors the Babylon renderer's data so
// generation can be developed and golden-tested without a browser (PLAN.md §1).
// Output is a deterministic string: coordinates are rounded so snapshots are
// stable across platforms.

import type { MapModel } from "../gen/types";
import { boundsSize } from "../gen/types";

export interface SvgOptions {
    /** Empty margin around the model bounds, world units. */
    padding?: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

export function renderModelSvg(model: MapModel, opts: SvgOptions = {}): string {
    const padding = opts.padding ?? 8;
    const { bounds } = model;
    const { width, height } = boundsSize(bounds);
    const w = round(width + padding * 2);
    const h = round(height + padding * 2);

    // Map generation (x, y) to SVG space: shift bounds to the padded origin and
    // flip y so larger generation-y renders toward the top.
    const tx = (x: number): number => round(x - bounds.minX + padding);
    const ty = (y: number): number => round(bounds.maxY - y + padding);

    const points = model.boundary.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ");

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
        `  <rect width="${w}" height="${h}" fill="#0c1016"/>`,
        `  <polygon points="${points}" fill="#276f2b" stroke="#e8ecf1" stroke-width="1" stroke-linejoin="round"/>`,
        `</svg>`,
        ``,
    ].join("\n");
}
