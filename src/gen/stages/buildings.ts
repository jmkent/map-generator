// Building stage: one house per parcel. PURE.
//
// Each lot's oriented bounding box gives the house orientation (aligned to its
// road frontage). The footprint is the lot inset by a yard and randomly shrunk a
// little for variety; the height is seeded per house. Lots too small to hold a
// viable footprint are skipped.

import type { Building, Parcel, Polygon, Vec2 } from "../types";
import type { Rng } from "../rng";
import { centroid, contains, orientedRect } from "../geometry/polygon";
import { dist, length, sub } from "../geometry/vec2";

export interface BuildingParams {
    yard: number;
    minHeight: number;
    maxHeight: number;
}

const MIN_FOOTPRINT = 2;

export function generateBuildings(rng: Rng, parcels: Parcel[], params: BuildingParams): Building[] {
    const { yard, minHeight, maxHeight } = params;
    const buildings: Building[] = [];

    for (const parcel of parcels) {
        if (parcel.polygon.length === 4) {
            const obb = orientedBounds(parcel.polygon);
            const maxW = obb.width - 2 * yard;
            const maxD = obb.depth - 2 * yard;
            if (maxW < MIN_FOOTPRINT || maxD < MIN_FOOTPRINT) continue;
            const width = maxW * rng.float(0.82, 1);
            const depth = maxD * rng.float(0.82, 1);
            const height = rng.float(minHeight, maxHeight);
            buildings.push({
                footprint: orientedRect(obb.center, width, depth, obb.angle),
                center: obb.center,
                width,
                depth,
                angle: obb.angle,
                height,
            });
            continue;
        }
        const frontage = sub(parcel.frontage[1], parcel.frontage[0]);
        const frontageLength = dist(parcel.frontage[0], parcel.frontage[1]);
        const center = centroid(parcel.buildablePolygon);
        const maxW = frontageLength - 2 * yard;
        const maxD = Math.max(0, maxDistanceToPolygonCenter(parcel.buildablePolygon, center) * 1.4 - 2 * yard);
        if (maxW < MIN_FOOTPRINT || maxD < MIN_FOOTPRINT) continue;

        let width = maxW * rng.float(0.7, 0.9);
        let depth = maxD * rng.float(0.5, 0.8);
        const height = rng.float(minHeight, maxHeight);
        const angle = Math.atan2(frontage.y, frontage.x);
        let footprint = orientedRect(center, width, depth, angle);
        for (let attempt = 0; attempt < 5 && !footprint.every((point) => contains(parcel.buildablePolygon, point)); attempt++) {
            width *= 0.78;
            depth *= 0.78;
            footprint = orientedRect(center, width, depth, angle);
        }
        if (!footprint.every((point) => contains(parcel.buildablePolygon, point))) continue;

        buildings.push({
            footprint,
            center,
            width,
            depth,
            angle,
            height,
        });
    }

    return buildings;
}

function maxDistanceToPolygonCenter(poly: Polygon, center: Vec2): number {
    return Math.max(...poly.map((point) => dist(point, center)));
}

/** Preserve the efficient legacy placement path for rectangular/parallelogram lots. */
function orientedBounds(quad: Polygon): { center: Vec2; width: number; depth: number; angle: number } {
    const center: Vec2 = {
        x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
        y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
    };
    const frontage = sub(quad[1], quad[0]);
    const depthEdge = sub(quad[2], quad[1]);
    return { center, width: length(frontage), depth: length(depthEdge), angle: Math.atan2(frontage.y, frontage.x) };
}
