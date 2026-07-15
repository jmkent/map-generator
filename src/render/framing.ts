// Pure camera-framing math for the fixed-angle map stage. NO Babylon imports —
// this is the unit-testable half of the camera (see PLAN.md M0 test plan). The
// Babylon-facing half lives in ./camera.ts.
//
// @babylonjs/lite exposes no orthographic projection on the camera, so we
// approximate one: a narrow FOV viewed from a correspondingly large radius makes
// perspective divergence across the scene negligible, giving the flat, map-like
// look. Widening STAGE_FOV (and reframing) later yields a perspective "diorama"
// toggle without changing the framing contract.

import type { Bounds } from "../gen/types";
import { boundsCenter, boundsRadius } from "../gen/types";

/** Orbit angle around Y (Babylon ArcRotate convention). */
export const STAGE_ALPHA = -Math.PI / 2;
/** Elevation from +Y. ~45° gives a tilted, near-top-down map view. */
export const STAGE_BETA = Math.PI / 4;
/** Narrow vertical FOV (radians) approximating an orthographic projection. */
export const STAGE_FOV = (8 * Math.PI) / 180;
/** Extra breathing room around the framed bounds (>= 1). */
export const STAGE_MARGIN = 1.1;

/** The fixed M0 stage: a 200×200 patch centered at the origin. */
export const STAGE_BOUNDS: Bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

export interface FramingParams {
    /** Vertical field of view, radians. */
    fovY: number;
    /** Viewport aspect ratio (width / height). */
    aspect: number;
    /** Extra breathing room multiplier (>= 1). */
    margin: number;
}

export interface Framing {
    /** World-space orbit target: bounds center on the ground plane. */
    target: [number, number, number];
    /** Distance from target so the bounds fit within the frustum. */
    radius: number;
}

/**
 * Distance at which a bounds rectangle fits within a perspective frustum.
 *
 * Fits the bounds' enclosing circle (rotation-invariant, so it holds for any
 * orbit/elevation angle — slightly conservative for non-square viewports). The
 * limiting half-angle is the smaller of the vertical and horizontal half-FOVs.
 */
export function frameBounds(bounds: Bounds, params: FramingParams): Framing {
    const { fovY, aspect, margin } = params;
    if (!(fovY > 0)) throw new Error("frameBounds: fovY must be > 0");
    if (!(aspect > 0)) throw new Error("frameBounds: aspect must be > 0");

    const c = boundsCenter(bounds);
    const r = boundsRadius(bounds);
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
    const halfAngle = Math.min(fovY, fovX) / 2;
    const radius = (r / Math.sin(halfAngle)) * margin;

    return { target: [c.x, 0, c.y], radius };
}

/**
 * Near/far planes that tightly bracket a target framed at `radius`, given the
 * bounds' enclosing-circle radius. Near is floored at a small positive value.
 */
export function stageNearFar(radius: number, boundsRadius: number): { near: number; far: number } {
    const pad = boundsRadius * 1.5;
    return { near: Math.max(0.1, radius - pad), far: radius + pad };
}
