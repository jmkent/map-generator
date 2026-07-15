// Babylon-facing camera construction for the fixed-angle stage. The framing
// math lives in ./framing.ts (pure, tested); this module only maps it onto a
// lite ArcRotateCamera.

import { createArcRotateCamera, type ArcRotateCamera } from "@babylonjs/lite";

import type { Bounds } from "../gen/types";
import { boundsRadius } from "../gen/types";
import {
    STAGE_ALPHA,
    STAGE_BETA,
    STAGE_FOV,
    STAGE_MARGIN,
    frameBounds,
    stageNearFar,
} from "./framing";

/** Create the fixed-angle stage camera, framed to `bounds` for the given aspect. */
export function createStageCamera(bounds: Bounds, aspect: number): ArcRotateCamera {
    const { target, radius } = frameBounds(bounds, { fovY: STAGE_FOV, aspect, margin: STAGE_MARGIN });
    const camera = createArcRotateCamera(STAGE_ALPHA, STAGE_BETA, radius, {
        x: target[0],
        y: target[1],
        z: target[2],
    });
    camera.fov = STAGE_FOV;
    const { near, far } = stageNearFar(radius, boundsRadius(bounds));
    camera.nearPlane = near;
    camera.farPlane = far;
    return camera;
}

/** Re-frame an existing stage camera (e.g. after a viewport resize). */
export function applyStageFraming(camera: ArcRotateCamera, bounds: Bounds, aspect: number): void {
    const { target, radius } = frameBounds(bounds, { fovY: STAGE_FOV, aspect, margin: STAGE_MARGIN });
    camera.radius = radius;
    camera.target.x = target[0];
    camera.target.y = target[1];
    camera.target.z = target[2];
    const { near, far } = stageNearFar(radius, boundsRadius(bounds));
    camera.nearPlane = near;
    camera.farPlane = far;
}
