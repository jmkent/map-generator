import { describe, expect, it } from "vitest";

import { COLORS, elevationBands, heightColor, heightColorHex, rgbToHex } from "../../src/render/palette";

describe("heightColor elevation ramp", () => {
    const seaLevel = 0;
    const min = -80;
    const max = 60;

    it("keeps channels in [0,1]", () => {
        for (let h = min; h <= max; h += 5) {
            const c = heightColor(h, seaLevel, min, max);
            for (const channel of [c.r, c.g, c.b]) expect(channel).toBeGreaterThanOrEqual(0), expect(channel).toBeLessThanOrEqual(1);
        }
    });

    it("colors below-sea heights blue (blue-dominant) and land not-blue", () => {
        const deep = heightColor(min, seaLevel, min, max);
        expect(deep.b).toBeGreaterThan(deep.r);
        expect(deep.b).toBeGreaterThan(deep.g);
        const midLand = heightColor(max * 0.3, seaLevel, min, max);
        expect(midLand.b).toBeLessThan(midLand.g); // green/brown, not blue
    });

    it("hits the ramp endpoints", () => {
        expect(heightColorHex(min, seaLevel, min, max)).toBe("#2c5a7a"); // deepest
        expect(heightColorHex(-1e-9, seaLevel, min, max)).toBe("#5fa8d3"); // shallow, at sea level
        expect(heightColorHex(seaLevel, seaLevel, min, max)).toBe("#d9cfa8"); // coast, first land stop
        expect(heightColorHex(max, seaLevel, min, max)).toBe("#e8e4dc"); // peak
    });

    it("darkens monotonically with depth below the sea", () => {
        // Deeper water is a darker blue: luminance decreases toward the deep end.
        const lum = (h: number) => { const c = heightColor(h, seaLevel, min, max); return c.r + c.g + c.b; };
        expect(lum(-70)).toBeLessThan(lum(-40));
        expect(lum(-40)).toBeLessThan(lum(-5));
    });
});

describe("elevationBands", () => {
    it("splits water and land with a contour at sea level, sorted high-to-low", () => {
        const { base, layers } = elevationBands(-80, 60, 0);
        // The base fills the highest band, so it is a pale peak-ish tone — lighter
        // than mid-elevation land.
        const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
        expect(lum(base)).toBeGreaterThan(lum(heightColorHex(20, 0, -80, 60)));
        expect(layers.length).toBeGreaterThan(6);
        const levels = layers.map((l) => l.level);
        // Painter's order: descending.
        for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThan(levels[i - 1]);
        // Sea level is a band boundary (the coastline).
        expect(levels.some((l) => Math.abs(l) < 1e-9)).toBe(true);
        // All levels strictly inside the range.
        for (const l of levels) expect(l).toBeGreaterThan(-80), expect(l).toBeLessThan(60);
    });

    it("emits only land bands when the terrain is entirely above sea level", () => {
        const { layers } = elevationBands(10, 40, 0);
        for (const { level } of layers) expect(level).toBeGreaterThan(0);
    });
});

describe("rgbToHex", () => {
    it("round-trips the feature palette values it formats", () => {
        expect(rgbToHex({ r: 1, g: 1, b: 1 })).toBe("#ffffff");
        expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
        expect(COLORS.water).toBe("#5fa8d3");
    });
});
