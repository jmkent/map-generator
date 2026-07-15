// Core spatial types for the generator. This module is PURE: it must never
// import Babylon or any rendering code (see PLAN.md §1). Generation works in a
// 2D plane using (x, y); the renderer maps a generation point to world space as
// (x, 0, y) — i.e. generation-y becomes world-z.

/** A point in the 2D generation plane. */
export interface Vec2 {
    x: number;
    y: number;
}

/** Axis-aligned bounds in the 2D generation plane. */
export interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Center point of a bounds rectangle. */
export function boundsCenter(b: Bounds): Vec2 {
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Width (x extent) and height (y extent) of a bounds rectangle. */
export function boundsSize(b: Bounds): { width: number; height: number } {
    return { width: b.maxX - b.minX, height: b.maxY - b.minY };
}

/** Radius of the circle that encloses the bounds rectangle. */
export function boundsRadius(b: Bounds): number {
    const { width, height } = boundsSize(b);
    return Math.hypot(width, height) / 2;
}

/** A closed polygon, given as an ordered ring of vertices (CCW by convention). */
export type Polygon = Vec2[];

/** Tunable inputs to the village generator. */
export interface VillageParams {
    /** Mean radius of the village boundary, world units. */
    radius: number;
    /** Number of vertices around the boundary ring. */
    boundaryPoints: number;
    /** Radial variation of the boundary, 0 (circle) .. ~0.5 (very lumpy). */
    boundaryIrregularity: number;
}

/**
 * The generated village. A plain, JSON-serializable value (no Babylon, no
 * functions) so it can be deep-compared, snapshotted, and rendered by either the
 * Babylon or SVG renderer. Grows one field per stage as milestones land.
 */
export interface MapModel {
    seed: string;
    params: VillageParams;
    bounds: Bounds;
    boundary: Polygon;
}
