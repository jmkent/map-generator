// 2D vector helpers over the plain { x, y } Vec2. Immutable: every function
// returns a new vector (or a scalar). PURE — no Babylon, no randomness.

import type { Vec2 } from "../types";

export function vec2(x: number, y: number): Vec2 {
    return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
    return { x: a.x * s, y: a.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
}

/** 2D cross product (z-component of the 3D cross): a.x*b.y - a.y*b.x. */
export function cross(a: Vec2, b: Vec2): number {
    return a.x * b.y - a.y * b.x;
}

export function lengthSq(a: Vec2): number {
    return a.x * a.x + a.y * a.y;
}

export function length(a: Vec2): number {
    return Math.hypot(a.x, a.y);
}

/** Unit vector in the direction of `a`. Returns (0,0) for a zero vector. */
export function normalize(a: Vec2): Vec2 {
    const len = Math.hypot(a.x, a.y);
    return len > 0 ? { x: a.x / len, y: a.y / len } : { x: 0, y: 0 };
}

/** Left-hand perpendicular: rotate 90° CCW. For a CCW polygon this points inward. */
export function perp(a: Vec2): Vec2 {
    return { x: -a.y, y: a.x };
}

export function dist(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distSq(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function rotate(a: Vec2, angle: number): Vec2 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function equals(a: Vec2, b: Vec2, eps = 1e-9): boolean {
    return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}
