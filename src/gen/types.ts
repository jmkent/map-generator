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
    /** Target number of primary through-roads; the final count varies by seed. */
    primaryRoadTarget: number;
    /** Polyline samples per Catmull–Rom segment of a generated road. */
    roadSamples: number;
    /** Maximum seeded anchor and curve variation, fraction of radius. */
    roadJitter: number;
    /** Margin keeping roads inside the boundary, fraction of radius. */
    roadInset: number;
    /** Soft budget for secondary connectors linking primary routes into blocks. */
    secondaryRoadBudget: number;
    /** Soft budget for frontage lanes off primary or secondary routes. */
    laneRoadBudget: number;
    /** Width of primary roads, world units. */
    primaryRoadWidth: number;
    /** Width of secondary roads, world units. */
    secondaryRoadWidth: number;
    /** Width of lanes, world units. */
    laneRoadWidth: number;
    /** Road-frontage width of a lot, world units. */
    lotWidth: number;
    /** Depth of a lot away from the road, world units. */
    lotDepth: number;
    /** Gap between a lot's front and the road edge, world units. */
    lotSetback: number;
    /** Random ± fraction applied to lot frontage width. */
    lotWidthJitter: number;
    /** Inset from a lot to its building footprint (yard), world units. */
    buildingYard: number;
    /** Building height range, world units. */
    buildingMinHeight: number;
    buildingMaxHeight: number;
    /** Clump strength: 0 sparse, 1 dense core (scales lot acceptance). */
    buildingDensity: number;
}

/** A buildable lot fronting a road. */
export interface Parcel {
    /** Lot outline (CCW quad). */
    polygon: Polygon;
}

/** A house: a road-oriented box footprint plus a height. Stored structurally so
 *  the renderer can thin-instance it and tests can inspect the footprint. */
export interface Building {
    /** Footprint outline (CCW rectangle). */
    footprint: Polygon;
    /** Footprint center. */
    center: Vec2;
    /** Extent along the road frontage. */
    width: number;
    /** Extent perpendicular to the road. */
    depth: number;
    /** Yaw of the frontage axis in the generation plane, radians. */
    angle: number;
    /** Extrusion height. */
    height: number;
}

/** Road class, widest to narrowest. `approach` (off-map entrances) arrives in M5. */
export type RoadClass = "primary" | "secondary" | "lane";

/** A junction/point in the road graph. */
export interface RoadNode {
    id: number;
    pos: Vec2;
}

/** A straight road segment between two nodes, with a class and render width. */
export interface RoadEdge {
    a: number;
    b: number;
    kind: RoadClass;
    width: number;
}

/** Road network as a planar graph: nodes (junctions/endpoints) joined by straight
 *  edges that meet only at nodes. Offset primaries form a loose grid; secondaries
 *  close local blocks and lanes add frontage. */
export interface RoadNetwork {
    nodes: RoadNode[];
    edges: RoadEdge[];
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
    roads: RoadNetwork;
    parcels: Parcel[];
    buildings: Building[];
}
