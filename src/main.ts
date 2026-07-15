// M0 bootstrap: resolve a seed (URL or freshly generated), reflect it in the URL
// so the view is shareable, show it in the HUD, and render the fixed-angle stage.
// Generation of an actual MapModel arrives in M1.

import "./style.css";
import { parseSeed, randomSeed, serializeState } from "./app/urlState";
import { createHud } from "./ui/hud";
import { createRenderer } from "./render/Renderer";
import { STAGE_BOUNDS } from "./render/framing";

const seed = parseSeed(window.location.search) ?? randomSeed();

// Reflect the resolved seed in the URL (without adding a history entry) so the
// stage is reproducible from a shared link even when no seed was supplied.
const query = serializeState({ seed });
if (window.location.search !== query) {
    history.replaceState(null, "", query);
}

const hud = createHud();
hud.setSeed(seed);

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
await createRenderer(canvas, STAGE_BOUNDS);
