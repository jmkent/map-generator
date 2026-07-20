#!/usr/bin/env node
// Local WebGPU evidence collector. This intentionally does not run in the
// regular test suite: it needs a locally installed Chrome with WebGPU support.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

export const DEFAULT_SEED = "wheeler";
export const DEFAULT_OUTPUT_DIR = "artifacts/render-validation";
export const MACOS_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function parseArgs(args) {
    const options = { seed: DEFAULT_SEED, browser: undefined, outputDir: DEFAULT_OUTPUT_DIR };
    for (let i = 0; i < args.length; i++) {
        const value = args[i];
        if (value === "--seed") options.seed = requiredValue(args, ++i, "--seed");
        else if (value === "--browser") options.browser = requiredValue(args, ++i, "--browser");
        else if (value === "--output-dir") options.outputDir = requiredValue(args, ++i, "--output-dir");
        else if (value === "--help" || value === "-h") options.help = true;
        else throw new Error(`Unknown option: ${value}`);
    }
    return options;
}

function requiredValue(args, index, flag) {
    const value = args[index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    return value;
}

export function resolveBrowserExecutable({ browser, environment = process.env, exists = existsSync } = {}) {
    const candidates = [browser, environment.PUPPETEER_EXECUTABLE_PATH, MACOS_CHROME].filter(Boolean);
    const executable = candidates.find((candidate) => exists(candidate));
    if (!executable) {
        throw new Error(
            "No Chrome executable found. Pass --browser /path/to/chrome or set PUPPETEER_EXECUTABLE_PATH. "
            + "puppeteer-core does not download a browser.",
        );
    }
    return executable;
}

export function validateDiagnostics({ webGpuAvailable, diagnostics, pixelDiagnostics, pageErrors, consoleErrors }) {
    const failures = [];
    if (!webGpuAvailable) failures.push("WebGPU is unavailable or Chrome could not obtain a GPU adapter.");
    if (pageErrors.length) failures.push(`Page errors: ${pageErrors.join(" | ")}`);
    if (consoleErrors.length) failures.push(`Console errors: ${consoleErrors.join(" | ")}`);
    if (diagnostics?.status !== "ready" || !diagnostics.renderer) {
        failures.push(`Renderer did not become ready${diagnostics?.error ? `: ${diagnostics.error}` : "."}`);
        return failures;
    }

    const { terrain, water } = diagnostics.renderer;
    if (terrain.bandCount < 2 || terrain.indexCount === 0 || terrain.cellCount === 0) {
        failures.push("Terrain bands were not submitted to the renderer.");
    }
    if (!terrain.colors.some(isBlueHex) || !terrain.colors.some(isLandHex)) {
        failures.push("Terrain band palette does not include both water-blue and land-green/brown colors.");
    }
    if (water.generatedKinds.length === 0) failures.push("The generated model contains no water bodies.");
    if (water.overlayKinds.some((kind) => kind === "coast")) {
        failures.push("Coast was submitted as a flat overlay; it should remain visible through terrain elevation bands.");
    }
    if (water.generatedKinds.includes("river") && (!water.overlayKinds.includes("river") || water.indexCount === 0)) {
        failures.push("Generated river was not submitted as a surface-water overlay.");
    }
    if (!pixelDiagnostics || pixelDiagnostics.landFraction < 0.05) {
        failures.push("Screenshot has too little rendered land-color coverage; terrain bands were submitted but are not visibly rendering.");
    }
    const hasCoast = water.generatedKinds.includes("coast");
    const hasSurfaceWater = water.generatedKinds.some((kind) => kind === "river" || kind === "pond" || kind === "lake");
    const blueThreshold = hasCoast ? 0.01 : hasSurfaceWater ? 0.001 : 0;
    if (!pixelDiagnostics || pixelDiagnostics.blueFraction < blueThreshold) {
        failures.push(hasCoast
            ? "Screenshot has too little rendered blue coverage; coast/terrain water is not visibly rendering."
            : "Screenshot has too little rendered blue coverage for the generated surface water.");
    }
    return failures;
}

function isBlueHex(hex) {
    const [r, g, b] = hexChannels(hex);
    return b > r && b > g;
}

function isLandHex(hex) {
    const [r, g, b] = hexChannels(hex);
    return g >= b || r >= b;
}

function hexChannels(hex) {
    return [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
    ];
}

async function analyzeScreenshot(page, pngBase64, terrainColors) {
    const blueColors = terrainColors.filter(isBlueHex).map(hexChannels);
    const landColors = terrainColors.filter(isLandHex).map(hexChannels);
    return page.evaluate(async ({ png, blue, land }) => {
        const response = await fetch(`data:image/png;base64,${png}`);
        const bitmap = await createImageBitmap(await response.blob());
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = surface.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Could not create a 2D canvas for screenshot diagnostics.");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const nearAny = (r, g, b, colors) => colors.some(([cr, cg, cb]) => (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2 <= 50 ** 2);
        let bluePixels = 0;
        let landPixels = 0;
        let sampledPixels = 0;
        // Sampling every fourth pixel keeps the report fast without making its
        // broad terrain-coverage thresholds sensitive to anti-aliasing.
        for (let index = 0; index < pixels.length; index += 16) {
            const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
            if (nearAny(r, g, b, blue)) bluePixels++;
            if (nearAny(r, g, b, land)) landPixels++;
            sampledPixels++;
        }
        return {
            sampledPixels,
            bluePixels,
            landPixels,
            blueFraction: bluePixels / sampledPixels,
            landFraction: landPixels / sampledPixels,
        };
    }, { png: pngBase64, blue: blueColors, land: landColors });
}

function usage() {
    return `Usage: npm run render:validate -- [--seed <seed>] [--browser <path>] [--output-dir <path>]`;
}

async function run(options) {
    const executablePath = resolveBrowserExecutable({ browser: options.browser });
    const outputDir = resolve(options.outputDir);
    await mkdir(outputDir, { recursive: true });

    const server = await createServer({
        server: { host: "127.0.0.1", port: 0, strictPort: false },
        appType: "spa",
    });
    let browser;
    try {
        await server.listen();
        const baseUrl = server.resolvedUrls?.local?.[0];
        if (!baseUrl) throw new Error("Vite did not report a local validation URL.");

        browser = await puppeteer.launch({
            executablePath,
            headless: true,
            args: ["--enable-unsafe-webgpu"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
        const pageErrors = [];
        const consoleErrors = [];
        const requestFailures = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("requestfailed", (request) => requestFailures.push(`${request.url()}: ${request.failure()?.errorText ?? "failed"}`));

        const url = new URL(`?seed=${encodeURIComponent(options.seed)}`, baseUrl).toString();
        await page.goto(url, { waitUntil: "networkidle0" });
        await page.waitForFunction(() => window.__mapGeneratorRenderDiagnostics?.status !== undefined, { timeout: 15_000 });
        await page.waitForFunction(() => window.__mapGeneratorRenderDiagnostics?.status === "ready", { timeout: 15_000 });
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

        const [diagnostics, webGpuAvailable, canvas] = await Promise.all([
            page.evaluate(() => window.__mapGeneratorRenderDiagnostics),
            page.evaluate(async () => {
                try { return Boolean(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
            }),
            page.$eval("#renderCanvas", (element) => ({ width: element.width, height: element.height, clientWidth: element.clientWidth, clientHeight: element.clientHeight })),
        ]);
        // The HUD is useful interactively but would pollute the broad color
        // coverage measurement used to prove the canvas itself rendered terrain.
        await page.addStyleTag({ content: ".hud { display: none !important; }" });
        const screenshot = resolve(outputDir, `${options.seed}.png`);
        const canvasElement = await page.$("#renderCanvas");
        if (!canvasElement) throw new Error("Render canvas was not found.");
        const pngBytes = await canvasElement.screenshot({ path: screenshot });
        const pngBase64 = Buffer.from(pngBytes).toString("base64");
        const pixelDiagnostics = diagnostics?.renderer
            ? await analyzeScreenshot(page, pngBase64, diagnostics.renderer.terrain.colors)
            : undefined;

        const report = {
            seed: options.seed,
            url,
            chrome: await browser.version(),
            webGpuAvailable,
            canvas,
            diagnostics,
            pixelDiagnostics,
            pageErrors,
            consoleErrors,
            requestFailures,
            screenshot,
        };
        await writeFile(resolve(outputDir, `${options.seed}.json`), `${JSON.stringify(report, null, 2)}\n`);
        const failures = validateDiagnostics({ webGpuAvailable, diagnostics, pixelDiagnostics, pageErrors, consoleErrors });
        if (failures.length) throw new Error(`${failures.join("\n")}\nDiagnostic artifacts: ${outputDir}`);
        console.log(`Render validation passed for seed "${options.seed}". Artifacts: ${outputDir}`);
    } finally {
        await browser?.close();
        await server.close();
    }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isEntrypoint) {
    try {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) console.log(usage());
        else await run(options);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        console.error(usage());
        process.exitCode = 1;
    }
}
