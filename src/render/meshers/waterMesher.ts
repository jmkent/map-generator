// Water mesher: flat ribbon quads for river channels, ear-clipped fills for closed
// bodies (ponds, lakes, and traced coastlines, which may be concave and — for an
// island's surrounding sea — have holes). PURE.

import type { Vec2, WaterBody } from "../../gen/types";
import type { GeometryData } from "../geometryData";

export function waterGeometry(water: readonly WaterBody[], y = 0): GeometryData {
    const segments = water.flatMap((body) => body.kind === "river"
        ? body.path.slice(1).map((_, index) => ({
            leftA: body.leftBank[index],
            rightA: body.rightBank[index],
            leftB: body.leftBank[index + 1],
            rightB: body.rightBank[index + 1],
        }))
        : []);
    // Bridge any holes into the outer ring so each closed body is one simple polygon.
    const rings = water
        .filter((body) => body.kind !== "river")
        .map((body) => (body.holes?.length ? bridgeHoles(body.polygon, body.holes) : body.polygon));
    const triangulations = rings.map(earClip);

    const riverVertexCount = segments.length * 4;
    const polygonVertexCount = rings.reduce((sum, ring) => sum + ring.length, 0);
    const polygonIndexCount = triangulations.reduce((sum, tris) => sum + tris.length, 0);
    const positions = new Float32Array((riverVertexCount + polygonVertexCount) * 3);
    const normals = new Float32Array((riverVertexCount + polygonVertexCount) * 3);
    const indices = new Uint32Array(segments.length * 6 + polygonIndexCount);

    segments.forEach((segment, index) => {
        const corners = [segment.leftA, segment.rightA, segment.rightB, segment.leftB];
        const base = index * 4;
        corners.forEach((corner, cornerIndex) => {
            const offset = (base + cornerIndex) * 3;
            positions[offset] = corner.x;
            positions[offset + 1] = y;
            positions[offset + 2] = corner.y;
            normals[offset + 1] = 1;
        });
        const offset = index * 6;
        indices[offset] = base;
        indices[offset + 1] = base + 2;
        indices[offset + 2] = base + 1;
        indices[offset + 3] = base;
        indices[offset + 4] = base + 3;
        indices[offset + 5] = base + 2;
    });

    let vertex = riverVertexCount;
    let index = segments.length * 6;
    rings.forEach((ring, ringIndex) => {
        const ringStart = vertex;
        for (const point of ring) {
            positions[vertex * 3] = point.x;
            positions[vertex * 3 + 1] = y;
            positions[vertex * 3 + 2] = point.y;
            normals[vertex * 3 + 1] = 1;
            vertex++;
        }
        for (const local of triangulations[ringIndex]) indices[index++] = ringStart + local;
    });

    return { positions, normals, indices };
}

/** Splice each hole into the outer ring with a zero-width bridge, producing one
 *  simple polygon that ear clipping can triangulate. */
function bridgeHoles(outer: readonly Vec2[], holes: readonly Vec2[][]): Vec2[] {
    let merged: Vec2[] = [...outer];
    // Bridge holes right-to-left so an outer vertex chosen for one is still valid.
    const ordered = [...holes].sort((a, b) => maxX(b) - maxX(a));
    for (const hole of ordered) {
        let mIdx = 0;
        for (let i = 1; i < hole.length; i++) if (hole[i].x > hole[mIdx].x) mIdx = i;
        const m = hole[mIdx];
        let oIdx = -1;
        let bestDistance = Infinity;
        for (let i = 0; i < merged.length; i++) {
            if (merged[i].x < m.x) continue;
            const d = (merged[i].x - m.x) ** 2 + (merged[i].y - m.y) ** 2;
            if (d < bestDistance && visible(m, merged[i], merged, i)) {
                bestDistance = d;
                oIdx = i;
            }
        }
        if (oIdx < 0) continue; // no clean bridge; leave this hole unfilled in 3D
        const rotated = [...hole.slice(mIdx), ...hole.slice(0, mIdx)];
        merged = [
            ...merged.slice(0, oIdx + 1),
            ...rotated,
            rotated[0],
            merged[oIdx],
            ...merged.slice(oIdx + 1),
        ];
    }
    return merged;
}

function maxX(poly: readonly Vec2[]): number {
    return poly.reduce((m, p) => Math.max(m, p.x), -Infinity);
}

/** Is the bridge segment m->o clear of the merged ring's edges (skipping the ones at o)? */
function visible(m: Vec2, o: Vec2, ring: readonly Vec2[], oIdx: number): boolean {
    for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        if (i === oIdx || j === oIdx) continue;
        if (segmentsCross(m, o, ring[i], ring[j])) return false;
    }
    return true;
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Ear-clipping triangulation of a simple CCW polygon; returns local index triples. */
function earClip(polygon: readonly Vec2[]): number[] {
    const n = polygon.length;
    if (n < 3) return [];
    const remaining = Array.from({ length: n }, (_, i) => i);
    const triangles: number[] = [];
    let guard = n * n;
    while (remaining.length > 3 && guard-- > 0) {
        let clipped = false;
        for (let i = 0; i < remaining.length; i++) {
            const prev = remaining[(i - 1 + remaining.length) % remaining.length];
            const curr = remaining[i];
            const next = remaining[(i + 1) % remaining.length];
            const a = polygon[prev];
            const b = polygon[curr];
            const c = polygon[next];
            if (cross(a, b, c) <= 0) continue; // reflex or collinear vertex — not an ear
            if (remaining.some((idx) => idx !== prev && idx !== curr && idx !== next && pointInTriangle(polygon[idx], a, b, c))) continue;
            triangles.push(prev, curr, next);
            remaining.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) break; // degenerate ring; emit what we have
    }
    if (remaining.length === 3) triangles.push(remaining[0], remaining[1], remaining[2]);
    return triangles;
}

function cross(a: Vec2, b: Vec2, c: Vec2): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
}
