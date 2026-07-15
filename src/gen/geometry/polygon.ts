// Polygon geometry: area, centroid, winding, point-in-polygon, simplicity, and
// a miter inward offset (inset). PURE — no Babylon, no randomness.
//
// Convention: a polygon is an ordered ring of vertices, implicitly closed
// (last connects to first), with CCW winding treated as positive area.

import type { Bounds, Polygon, Vec2 } from "../types";
import { perp, normalize, sub, scale, add, cross } from "./vec2";

/** Signed area via the shoelace formula. Positive for CCW winding. */
export function signedArea(poly: Polygon): number {
    const n = poly.length;
    let sum = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    }
    return sum / 2;
}

export function area(poly: Polygon): number {
    return Math.abs(signedArea(poly));
}

export function isCCW(poly: Polygon): boolean {
    return signedArea(poly) > 0;
}

/** Return the polygon in CCW order (reversing a copy if needed). */
export function ensureCCW(poly: Polygon): Polygon {
    return isCCW(poly) ? poly : [...poly].reverse();
}

export function perimeter(poly: Polygon): number {
    const n = poly.length;
    let sum = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        sum += Math.hypot(poly[i].x - poly[j].x, poly[i].y - poly[j].y);
    }
    return sum;
}

/** Area-weighted centroid. Falls back to the vertex average for degenerate area. */
export function centroid(poly: Polygon): Vec2 {
    const n = poly.length;
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
        a += cross;
        cx += (poly[j].x + poly[i].x) * cross;
        cy += (poly[j].y + poly[i].y) * cross;
    }
    if (Math.abs(a) < 1e-12) {
        let sx = 0;
        let sy = 0;
        for (const p of poly) {
            sx += p.x;
            sy += p.y;
        }
        return { x: sx / n, y: sy / n };
    }
    const inv = 1 / (3 * a);
    return { x: cx * inv, y: cy * inv };
}

export function bounds(poly: Polygon): Bounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

/** Expand an axis-aligned bounds rectangle by a uniform world-space margin. */
export function expandBounds(b: Bounds, margin: number): Bounds {
    return { minX: b.minX - margin, minY: b.minY - margin, maxX: b.maxX + margin, maxY: b.maxY + margin };
}

/** Point-in-polygon via ray casting. Boundary points are not guaranteed either
 *  way — use {@link distanceToBoundary} when on-edge behavior matters. */
export function contains(poly: Polygon, p: Vec2): boolean {
    const n = poly.length;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y)) {
            const t = (p.y - a.y) / (b.y - a.y);
            if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
        }
    }
    return inside;
}

/** Shortest distance from a point to the polygon's boundary edges. */
export function distanceToBoundary(poly: Polygon, p: Vec2): number {
    const n = poly.length;
    let best = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        best = Math.min(best, pointSegmentDistance(p, poly[j], poly[i]));
    }
    return best;
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    let t = lenSq > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/** True if no two non-adjacent edges cross (a simple, non-self-intersecting ring). */
export function isSimple(poly: Polygon): boolean {
    const n = poly.length;
    if (n < 3) return false;
    for (let i = 0; i < n; i++) {
        const a1 = poly[i];
        const a2 = poly[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
            // Skip shared-vertex neighbors (adjacent edges and the closing wrap).
            if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
            const b1 = poly[j];
            const b2 = poly[(j + 1) % n];
            if (segmentsIntersect(a1, a2, b1, b2)) return false;
        }
    }
    return true;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
    const d1 = orient(p3, p4, p1);
    const d2 = orient(p3, p4, p2);
    const d3 = orient(p1, p2, p3);
    const d4 = orient(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Inward miter offset by `dist`. Each edge is shifted inward along its normal and
 * consecutive shifted edges are intersected to form the new vertices. Assumes a
 * CCW, convex-ish polygon: it does not resolve self-intersections that a large
 * inset can produce on concave shapes (adequate for the M1 organic boundary).
 */
export function inset(poly: Polygon, dist: number): Polygon {
    const n = poly.length;
    const result: Polygon = [];
    for (let i = 0; i < n; i++) {
        const prev = poly[(i - 1 + n) % n];
        const curr = poly[i];
        const next = poly[(i + 1) % n];

        const nIn = normalize(perp(sub(curr, prev))); // inward normal of edge prev->curr
        const nOut = normalize(perp(sub(next, curr))); // inward normal of edge curr->next

        // Two offset lines through `curr`, shifted inward. Intersect them.
        const aPoint = add(curr, scale(nIn, dist));
        const bPoint = add(curr, scale(nOut, dist));
        const hit = lineIntersect(aPoint, sub(curr, prev), bPoint, sub(next, curr));
        result.push(hit ?? add(curr, scale(nIn, dist)));
    }
    return result;
}

/** Build a CCW oriented rectangle centered at `center`, sized width×depth, with
 *  its width axis rotated by `angle` (radians) in the generation plane. */
export function orientedRect(center: Vec2, width: number, depth: number, angle: number): Polygon {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const hw = width / 2;
    const hd = depth / 2;
    const locals: Array<[number, number]> = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
    ];
    return locals.map(([lx, ly]) => ({ x: center.x + lx * c - ly * s, y: center.y + lx * s + ly * c }));
}

function projectOnto(poly: Polygon, axis: Vec2): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const p of poly) {
        const d = p.x * axis.x + p.y * axis.y;
        if (d < min) min = d;
        if (d > max) max = d;
    }
    return [min, max];
}

/** True if any edge-normal of `a` separates `a` from `b` (a gap, or contact within eps). */
function hasSeparatingAxis(a: Polygon, b: Polygon, eps: number): boolean {
    const n = a.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const edge = sub(a[i], a[j]);
        const len = Math.hypot(edge.x, edge.y);
        if (len < 1e-12) continue;
        const axis = { x: -edge.y / len, y: edge.x / len };
        const [minA, maxA] = projectOnto(a, axis);
        const [minB, maxB] = projectOnto(b, axis);
        if (maxA <= minB + eps || maxB <= minA + eps) return true;
    }
    return false;
}

/**
 * Do two convex polygons overlap by more than `eps` (separating-axis theorem)?
 * Shared edges / touching corners count as non-overlapping, so tiled lots that
 * abut along an edge are not reported as colliding.
 */
export function convexOverlap(a: Polygon, b: Polygon, eps = 1e-6): boolean {
    return !hasSeparatingAxis(a, b, eps) && !hasSeparatingAxis(b, a, eps);
}

/**
 * Nearest forward intersection of a ray (origin + t·dir, t>0) with the polygon's
 * edges. Returns the hit point and its distance along the ray, or null if the
 * ray misses. `dir` need not be normalized; `distance` is in units of `dir`.
 */
export function intersectRayPolygon(
    poly: Polygon,
    origin: Vec2,
    dir: Vec2,
): { point: Vec2; distance: number } | null {
    const n = poly.length;
    let best: { point: Vec2; distance: number } | null = null;
    const eps = 1e-9;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = poly[j];
        const b = poly[i];
        const e = sub(b, a);
        const denom = cross(dir, e);
        if (Math.abs(denom) < eps) continue; // ray parallel to edge
        const diff = sub(a, origin);
        const t = cross(diff, e) / denom; // distance along ray
        const u = cross(diff, dir) / denom; // position along edge [0,1]
        if (t > eps && u >= -eps && u <= 1 + eps) {
            if (best === null || t < best.distance) {
                best = { point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t }, distance: t };
            }
        }
    }
    return best;
}

/** Intersection of two lines given point+direction each. Null if parallel. */
function lineIntersect(p: Vec2, r: Vec2, q: Vec2, s: Vec2): Vec2 | null {
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-12) return null;
    const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / denom;
    return { x: p.x + t * r.x, y: p.y + t * r.y };
}
