import { describe, expect, it } from "vitest";

import {
    DEFAULT_SEED,
    MACOS_CHROME,
    parseArgs,
    resolveBrowserExecutable,
    validateDiagnostics,
} from "../../scripts/render-validation.mjs";

describe("render validation configuration", () => {
    it("uses wheeler unless a seed is provided", () => {
        expect(DEFAULT_SEED).toBe("wheeler");
        expect(parseArgs([])).toMatchObject({ seed: "wheeler" });
        expect(parseArgs(["--seed", "riverford", "--output-dir", "tmp/render"]))
            .toMatchObject({ seed: "riverford", outputDir: "tmp/render" });
    });

    it("resolves an explicit browser before environment and macOS defaults", () => {
        const exists = (candidate: string) => candidate === "/custom/chrome" || candidate === MACOS_CHROME;
        expect(resolveBrowserExecutable({ browser: "/custom/chrome", environment: { PUPPETEER_EXECUTABLE_PATH: "/env/chrome" }, exists }))
            .toBe("/custom/chrome");
        expect(resolveBrowserExecutable({ environment: { PUPPETEER_EXECUTABLE_PATH: "/env/chrome" }, exists: (candidate: string) => candidate === "/env/chrome" }))
            .toBe("/env/chrome");
    });

    it("reports missing browser setup and missing render evidence clearly", () => {
        expect(() => resolveBrowserExecutable({ environment: {}, exists: () => false })).toThrow(/No Chrome executable/);
        expect(validateDiagnostics({ webGpuAvailable: false, diagnostics: undefined, pixelDiagnostics: undefined, pageErrors: [], consoleErrors: [] }))
            .toEqual(expect.arrayContaining([expect.stringMatching(/WebGPU/), expect.stringMatching(/Renderer did not become ready/)]));
    });

    it("treats missing terrain-colored pixels as a presentation failure", () => {
        const diagnostics = {
            status: "ready" as const,
            seed: "wheeler",
            renderer: {
                terrain: { bandCount: 18, colors: ["#306182", "#467a3c"], cellCount: 4096, indexCount: 24576 },
                water: { generatedKinds: ["river", "coast"], overlayKinds: ["river"], indexCount: 240 },
            },
        };
        expect(validateDiagnostics({
            webGpuAvailable: true,
            diagnostics,
            pixelDiagnostics: { landFraction: 0.001, blueFraction: 0.001 },
            pageErrors: [],
            consoleErrors: [],
        })).toEqual(expect.arrayContaining([expect.stringMatching(/terrain bands were submitted but are not visibly rendering/)]));
    });
});
