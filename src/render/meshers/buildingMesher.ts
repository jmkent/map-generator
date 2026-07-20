// Building mesher: map each house to a thin-instance transform of a unit box.
// PURE — emits InstanceTransforms; the Renderer composes matrices and uploads.
//
// The box is 1×1×1 centered at the origin, so scale = (width, height, depth) and
// the y position is height/2 to seat the box on the ground. Generation-plane
// coordinates (x, y) map to world (x, z); the frontage yaw negates to account for
// that handedness flip (verified against the rendered result).

import type { Building } from "../../gen/types";
import type { InstanceTransform } from "../geometryData";

export function buildingInstances(buildings: Building[], baseY = 0): InstanceTransform[] {
    return buildings.map((b) => ({
        position: [b.center.x, baseY + b.height / 2, b.center.y],
        rotationY: -b.angle,
        scale: [b.width, b.height, b.depth],
    }));
}
