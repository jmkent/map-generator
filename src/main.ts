// M0 bootstrap: resolve a seed (URL or freshly generated), reflect it in the URL
// so the view is shareable, show it in the HUD, and render the fixed-angle stage.
// Generation of an actual MapModel arrives in M1.

import "./style.css";
import { parseSeed, randomSeed, serializeState } from "./app/urlState";
import { geometryDiagnostics } from "./app/geometryDiagnostics";
import { createHud } from "./ui/hud";
import { createRenderer } from "./render/Renderer";
import { generateVillage } from "./gen/pipeline";
import type { BrowserRenderDiagnostics } from "./app/renderDiagnostics";

declare global {
    interface Window {
        __mapGeneratorRenderDiagnostics?: BrowserRenderDiagnostics;
    }
}

const seed = parseSeed(window.location.search) ?? randomSeed();

// Reflect the resolved seed in the URL (without adding a history entry) so the
// stage is reproducible from a shared link even when no seed was supplied.
const query = serializeState({ seed });
if (window.location.search !== query) {
    history.replaceState(null, "", query);
}

const hud = createHud();
hud.setSeed(seed);

const model = generateVillage(seed);
hud.setDiagnostics(geometryDiagnostics(model));

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
try {
    const renderer = await createRenderer(canvas, model);
    window.__mapGeneratorRenderDiagnostics = { status: "ready", seed, renderer: renderer.diagnostics };
} catch (error) {
    window.__mapGeneratorRenderDiagnostics = {
        status: "error",
        seed,
        error: error instanceof Error ? error.message : String(error),
    };
    throw error;
}
