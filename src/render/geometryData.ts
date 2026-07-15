// Plain triangle-mesh data produced by meshers, independent of Babylon. Meshers
// emit this (headlessly testable) and a thin adapter uploads it via
// createMeshFromData. Layout matches lite's createMeshFromData arguments.

export interface GeometryData {
    /** Interleaved xyz positions, length = vertexCount * 3. */
    positions: Float32Array;
    /** Interleaved xyz normals, length = vertexCount * 3. */
    normals: Float32Array;
    /** Triangle indices, length = triangleCount * 3. */
    indices: Uint32Array;
}

/** A single thin-instance transform, Babylon-agnostic. The Renderer composes
 *  these into matrices via lite's mat4Compose. */
export interface InstanceTransform {
    /** World translation (x, y, z). */
    position: [number, number, number];
    /** Yaw about the world Y axis, radians. */
    rotationY: number;
    /** World-space box dimensions (x, y, z). */
    scale: [number, number, number];
}
