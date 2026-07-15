// Centripetal Catmull–Rom spline through a sequence of control points. PURE.
//
// The curve passes through every control point. Endpoints are handled by
// extrapolating phantom points (reflecting the first/last segment) so the ends
// are not clamped and no two knots coincide. Centripetal parameterization
// (alpha = 0.5) avoids the cusps and self-intersections the uniform variant can
// produce on unevenly spaced points.

import type { Vec2 } from "../types";

function knot(t: number, a: Vec2, b: Vec2, alpha: number): number {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    return t + Math.pow(d, alpha);
}

function lerpAt(a: Vec2, b: Vec2, ta: number, tb: number, t: number): Vec2 {
    // Guard coincident knots (degenerate spacing) by falling back to `a`.
    if (tb === ta) return { x: a.x, y: a.y };
    const w = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
}

/**
 * Sample a centripetal Catmull–Rom spline. Returns a polyline that includes the
 * first and last control point. `samplesPerSegment` new points are produced per
 * span (plus the shared endpoints), so the polyline has
 * `(n-1) * samplesPerSegment + 1` points for n control points.
 */
export function catmullRom(points: readonly Vec2[], samplesPerSegment = 12, alpha = 0.5): Vec2[] {
    if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
    if (points.length === 2) {
        // Straight line, sampled uniformly.
        const out: Vec2[] = [];
        for (let s = 0; s <= samplesPerSegment; s++) {
            const w = s / samplesPerSegment;
            out.push({ x: points[0].x + (points[1].x - points[0].x) * w, y: points[0].y + (points[1].y - points[0].y) * w });
        }
        return out;
    }

    const n = points.length;
    const reflectStart: Vec2 = { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y };
    const reflectEnd: Vec2 = { x: 2 * points[n - 1].x - points[n - 2].x, y: 2 * points[n - 1].y - points[n - 2].y };
    const cp: Vec2[] = [reflectStart, ...points, reflectEnd];

    const out: Vec2[] = [];
    for (let i = 1; i < cp.length - 2; i++) {
        const p0 = cp[i - 1];
        const p1 = cp[i];
        const p2 = cp[i + 1];
        const p3 = cp[i + 2];

        const t0 = 0;
        const t1 = knot(t0, p0, p1, alpha);
        const t2 = knot(t1, p1, p2, alpha);
        const t3 = knot(t2, p2, p3, alpha);

        // First span emits its start point; later spans skip it (shared endpoint).
        const startS = i === 1 ? 0 : 1;
        for (let s = startS; s <= samplesPerSegment; s++) {
            const t = t1 + ((t2 - t1) * s) / samplesPerSegment;
            const a1 = lerpAt(p0, p1, t0, t1, t);
            const a2 = lerpAt(p1, p2, t1, t2, t);
            const a3 = lerpAt(p2, p3, t2, t3, t);
            const b1 = lerpAt(a1, a2, t0, t2, t);
            const b2 = lerpAt(a2, a3, t1, t3, t);
            out.push(lerpAt(b1, b2, t1, t2, t));
        }
    }
    return out;
}
