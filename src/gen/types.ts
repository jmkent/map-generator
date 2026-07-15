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
