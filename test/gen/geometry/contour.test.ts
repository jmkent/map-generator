import { describe, expect, it } from "vitest";

import { isoContours, type ContourGrid } from "../../../src/gen/geometry/contour";
import { signedArea } from "../../../src/gen/geometry/polygon";

function grid(values: number[], size: number): ContourGrid {
    return { values, cols: size, rows: size, toWorld: (col, row) => ({ x: col, y: row }) };
}

// A field that is high (land) everywhere except one low (sea) cell in the middle.
function centralSea(size: number): number[] {
    const values: number[] = [];
    const mid = (size - 1) / 2;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) values.push(c === mid && r === mid ? -1 : 1);
    return values;
}

describe("isoContours", () => {
    it("encloses a below-threshold pool in a single CCW loop", () => {
        const loops = isoContours(grid(centralSea(5), 5), 0);
        expect(loops).toHaveLength(1);
        // Sea is inside, so the loop winds CCW (positive signed area).
        expect(signedArea(loops[0])).toBeGreaterThan(0);
        // A diamond around the single sea point.
        expect(loops[0].length).toBe(4);
    });

    it("orients an above-threshold island loop CW inside the surrounding sea", () => {
        const size = 5;
        const mid = (size - 1) / 2;
        const values: number[] = [];
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) values.push(c === mid && r === mid ? 1 : -1);
        const loops = isoContours(grid(values, size), 0);

        // A ring of sea between the map border and the central island: an outer
        // sea loop (CCW) and the island loop (CW).
        const areas = loops.map(signedArea);
        expect(areas.some((a) => a > 0)).toBe(true); // sea encloses the map
        expect(areas.some((a) => a < 0)).toBe(true); // island is a hole
    });

    it("traces the map border for a fully-submerged field and nothing for a dry one", () => {
        // All sea: the region's boundary is the border ring — one loop.
        expect(isoContours(grid(new Array(16).fill(-1), 4), 0)).toHaveLength(1);
        // All land: no shoreline at all.
        expect(isoContours(grid(new Array(16).fill(5), 4), 0)).toHaveLength(0);
    });

    it("interpolates the shoreline position from corner values", () => {
        // Left column below (-1), right column above (+3): the sea's right shore
        // crosses at 25% toward the right on a unit cell, i.e. x = 0.25.
        const values = [-1, 3, -1, 3];
        const loops = isoContours({ values, cols: 2, rows: 2, toWorld: (col, row) => ({ x: col, y: row }) }, 0);
        expect(loops).toHaveLength(1);
        const xs = loops[0].map((p) => p.x);
        expect(Math.max(...xs)).toBeCloseTo(0.25, 6);
    });
});
