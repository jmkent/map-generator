// Settlement-profile selection and shared layout constraints. PURE.

import type {
    CivicSpace,
    Polygon,
    ResolvedSettlementProfile,
    SettlementLayout,
    SettlementProfile,
    ResolvedTerrainProfile,
    Vec2,
} from "../types";
import type { Rng } from "../rng";
import { centroid, contains } from "../geometry/polygon";
import { add, normalize, scale } from "../geometry/vec2";

export interface LayoutParams {
    boundary: Polygon;
    radius: number;
    profile: SettlementProfile;
    terrainProfile?: ResolvedTerrainProfile;
}

const AUTO_PROFILES: ResolvedSettlementProfile[] = ["haufendorf", "reihendorf", "tenement", "angerdorf", "weiler", "rundling", "estate"];

export function generateLayout(rng: Rng, params: LayoutParams): SettlementLayout {
    const profile = params.profile === "auto" ? rng.pick(AUTO_PROFILES) : params.profile;
    const center = centroid(params.boundary);
    const angle = terrainAxis(params.terrainProfile) ?? rng.float(0, Math.PI);
    const axis = { x: Math.cos(angle), y: Math.sin(angle) };
    const anchor = add(center, { x: rng.float(-params.radius * 0.05, params.radius * 0.05), y: rng.float(-params.radius * 0.05, params.radius * 0.05) });
    const safeAnchor = contains(params.boundary, anchor) ? anchor : center;
    const civicSpaces = profile === "angerdorf" || profile === "rundling" ? [green(profile, safeAnchor, axis, params.radius)] : [];

    const attributes = {
        estate: { scale: "estate", nucleation: "compact", geometry: "clustered" },
        weiler: { scale: "hamlet", nucleation: "dispersed", geometry: "clustered" },
        haufendorf: { scale: "village", nucleation: "compact", geometry: "clustered" },
        reihendorf: { scale: "village", nucleation: "compact", geometry: "linear" },
        tenement: { scale: "village", nucleation: "compact", geometry: "frontage" },
        angerdorf: { scale: "village", nucleation: "compact", geometry: "common" },
        rundling: { scale: "hamlet", nucleation: "compact", geometry: "radial" },
    } as const;
    const picked = attributes[profile];
    return { profile, ...picked, anchor: safeAnchor, axis: normalize(axis), civicSpaces };
}

function terrainAxis(profile: ResolvedTerrainProfile | undefined): number | undefined {
    if (profile === "river-valley" || profile === "ridge") return Math.PI / 2;
    if (profile === "lakeshore" || profile === "coast" || profile === "cove" || profile === "peninsula") return 0;
    if (profile === "hillside") return Math.PI * 0.25;
    return undefined;
}

function green(profile: ResolvedSettlementProfile, center: Vec2, axis: Vec2, radius: number): CivicSpace {
    const normal = { x: -axis.y, y: axis.x };
    const along = profile === "angerdorf" ? radius * 0.24 : radius * 0.12;
    const across = profile === "angerdorf" ? radius * 0.09 : radius * 0.12;
    const points: Vec2[] = [];
    const count = 12;
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        points.push(add(add(center, scale(axis, Math.cos(a) * along)), scale(normal, Math.sin(a) * across)));
    }
    return { kind: "green", polygon: points };
}
