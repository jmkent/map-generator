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
import { boundsCenter, boundsSize } from "../gen/types";

/** Orbit angle around Y (Babylon ArcRotate convention). */
export const STAGE_ALPHA = -Math.PI / 2;
/** Elevation from +Y. ~45° gives a tilted, near-top-down map view. */
export const STAGE_BETA = Math.PI / 4;
/** Narrow vertical FOV (radians) approximating an orthographic projection. */
export const STAGE_FOV = (8 * Math.PI) / 180;
/** Extra breathing room around the framed bounds (>= 1). */
export const STAGE_MARGIN = 1.04;

export interface FramingParams {
    /** Vertical field of view, radians. */
    fovY: number;
    /** Viewport aspect ratio (width / height). */
    aspect: number;
    /** Extra breathing room multiplier (>= 1). */
    margin: number;
    /** Orbit angle around the ground-plane normal, in radians. */
    alpha?: number;
    /** Elevation from the ground-plane normal, in radians. */
    beta?: number;
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
 * Projects the axis-aligned ground rectangle into the fixed camera axes, rather
 * than fitting its enclosing circle. The old circle fit was safe but left a
 * large unused border at the stage's fixed 45-degree tilt.
 */
export function frameBounds(bounds: Bounds, params: FramingParams): Framing {
    const { fovY, aspect, margin } = params;
    if (!(fovY > 0)) throw new Error("frameBounds: fovY must be > 0");
    if (!(aspect > 0)) throw new Error("frameBounds: aspect must be > 0");

    const c = boundsCenter(bounds);
    const { width, height } = boundsSize(bounds);
    const alpha = params.alpha ?? 0;
    const beta = params.beta ?? 0;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
    const horizontalExtent = Math.abs(Math.sin(alpha)) * halfWidth + Math.abs(Math.cos(alpha)) * halfHeight;
    const forwardExtent = Math.abs(Math.cos(alpha)) * halfWidth + Math.abs(Math.sin(alpha)) * halfHeight;
    const verticalExtent = Math.abs(Math.cos(beta)) * forwardExtent;
    // The near side of the ground rectangle sits closer to the camera. Add its
    // forward extent before applying the perspective half-angle constraints.
    const depthExtent = Math.abs(Math.sin(beta)) * forwardExtent;
    const radius = (Math.max(horizontalExtent / Math.tan(fovX / 2), verticalExtent / Math.tan(fovY / 2)) + depthExtent) * margin;

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
