// Scene palette: a terrain-elevation gradient shared by both renderers, plus scene
// colors. PURE — no Babylon. This is the single source of truth for how height maps
// to color, so the SVG hypsometric bands and the Babylon per-vertex mesh colors agree.

import { clamp } from "../gen/geometry/scalar";

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

// --- Elevation ramp (naturalistic topographic) ---
// Below sea level: deep -> shallow blue. Above: coast/beach -> lowland green ->
// highland brown -> pale peak. Land stops are placed by normalized elevation so a
// thin beach hugs the shoreline and greens dominate the low ground.
const DEEP = hexToRgb("#2c5a7a");
const SHALLOW = hexToRgb("#5fa8d3");
const LAND_STOPS: Array<{ t: number; rgb: Rgb }> = [
    { t: 0.0, rgb: hexToRgb("#d9cfa8") }, // coast / beach
    { t: 0.1, rgb: hexToRgb("#3f7a3a") }, // lowland green
    { t: 0.5, rgb: hexToRgb("#8a7a4a") }, // highland brown
    { t: 1.0, rgb: hexToRgb("#e8e4dc") }, // pale peak
];

/**
 * Color for a terrain height, normalized per-terrain (so every profile uses the
 * full ramp regardless of its absolute range). Split at sea level: `[min, seaLevel]`
 * maps onto the water ramp, `[seaLevel, max]` onto the land ramp.
 */
export function heightColor(height: number, seaLevel: number, min: number, max: number): Rgb {
    if (height < seaLevel) {
        const span = seaLevel - min || 1;
        return lerpRgb(DEEP, SHALLOW, clamp((height - min) / span, 0, 1));
    }
    const landStart = Math.max(seaLevel, min);
    const span = max - landStart || 1;
    return sampleRamp(LAND_STOPS, clamp((height - landStart) / span, 0, 1));
}

export function heightColorHex(height: number, seaLevel: number, min: number, max: number): string {
    return rgbToHex(heightColor(height, seaLevel, min, max));
}

// --- Hypsometric bands for the SVG renderer ---
const WATER_BANDS = 4;
const LAND_BANDS = 6;

/**
 * Contour levels and fill colors for painter's-algorithm elevation bands: fill the
 * map with `base` (the peak), then draw the region below each `level` (highest first)
 * in its color. Returns levels sorted descending so the caller paints high -> low.
 */
export function elevationBands(min: number, max: number, seaLevel: number): { base: string; layers: Array<{ level: number; hex: string }> } {
    const levels: number[] = [];
    if (min < seaLevel) {
        for (let i = 1; i <= WATER_BANDS; i++) levels.push(min + (seaLevel - min) * i / WATER_BANDS); // last = seaLevel (the coastline)
    }
    const landStart = Math.max(seaLevel, min);
    for (let j = 1; j < LAND_BANDS; j++) levels.push(landStart + (max - landStart) * j / LAND_BANDS);

    const sorted = [...new Set(levels)].filter((l) => l > min + 1e-9 && l < max - 1e-9).sort((a, b) => a - b);
    const layers = sorted.map((level, index) => {
        const lower = index === 0 ? min : sorted[index - 1];
        return { level, hex: heightColorHex((lower + level) / 2, seaLevel, min, max) };
    }).reverse();
    const topLevel = sorted.length ? sorted[sorted.length - 1] : min;
    const base = heightColorHex((topLevel + max) / 2, seaLevel, min, max);
    return { base, layers };
}

// --- Scene colors (map framing) ---
export const BACKGROUND = "#1a1f2b"; // non-map field of view (dark slate)
export const MAP_FRAME = "#a8b0bd"; // border around the map extent

// --- Feature colors (de-inlined from the renderers) ---
export const COLORS = {
    grass: "#276f2b",
    boundary: "#e8ecf1",
    civicFill: "#5f9f61",
    civicStroke: "#dce9b0",
    water: "#5fa8d3",
    waterStroke: "#bfe0f2",
    roadPrimary: "#d9c48a",
    roadSecondary: "#c9b47a",
    roadLane: "#b9a878",
    roadTrack: "#718096",
    parcelStroke: "#4a5568",
    buildingFill: "#b08d64",
    buildingStroke: "#5c4630",
} as const;

// --- helpers ---
function sampleRamp(stops: Array<{ t: number; rgb: Rgb }>, t: number): Rgb {
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i].t) {
            const span = stops[i].t - stops[i - 1].t || 1;
            return lerpRgb(stops[i - 1].rgb, stops[i].rgb, (t - stops[i - 1].t) / span);
        }
    }
    return stops[stops.length - 1].rgb;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

export function hexToRgb(value: string): Rgb {
    const n = parseInt(value.slice(1), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgbToHex(rgb: Rgb): string {
    const channel = (c: number): string => Math.round(clamp(c, 0, 1) * 255).toString(16).padStart(2, "0");
    return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}
