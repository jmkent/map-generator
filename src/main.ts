import {
    createEngine,
    createSceneContext,
    createArcRotateCamera,
    attachControl,
    createHemisphericLight,
    createSphere,
    createBox,
    createCylinder,
    createTorus,
    createGround,
    createStandardMaterial,
    createGridMaterial,
    addToScene,
    registerScene,
    startEngine,
    onBeforeRender,
    type Mesh,
    type SceneContext,
} from "@babylonjs/lite";

import "./style.css";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

// Size of the (square) floor in world units. Objects are placed on an integer
// grid inside [-GROUND_SIZE/2, GROUND_SIZE/2] so the overlay reads as a ruler.
const GROUND_SIZE = 20;

// 1. Engine
const engine = await createEngine(canvas);

// 2. Scene
const scene = createSceneContext(engine);

const bgColor: GPUColorDict = { r: 0.05, g: 0.06, b: 0.08, a: 1.0 };
scene.clearColor = bgColor;

// --- Bottom plane: a solid green ground -------------------------------------
const ground = createGround(engine, { width: GROUND_SIZE, height: GROUND_SIZE });
const groundMat = createStandardMaterial();
groundMat.diffuseColor = [0.15, 0.55, 0.2];
groundMat.specularColor = [0.05, 0.05, 0.05]; // matte, no hotspot
ground.material = groundMat;
addToScene(scene, ground);

// --- Measurement grid overlay -----------------------------------------------
// A second, transparent ground floating just above the green plane. Its grid
// material draws 1-unit minor lines and 5-unit major lines so you can read off
// where each object sits in X/Z.
const gridOverlay = createGround(engine, { width: GROUND_SIZE, height: GROUND_SIZE });
gridOverlay.position.y = 0.02; // avoid z-fighting with the green ground
gridOverlay.material = createGridMaterial({
    mainColor: [0, 0, 0],
    lineColor: [0.9, 0.95, 1.0],
    gridRatio: 1,             // one minor line per world unit
    majorUnitFrequency: 5,    // every 5th line is a bright major line
    minorUnitVisibility: 0.4,
    opacity: 0.85,            // <1 -> transparent path, green shows through
});
gridOverlay.pickable = false;
addToScene(scene, gridOverlay);

// --- Camera + light ---------------------------------------------------------
const camera = createArcRotateCamera(-Math.PI / 3, Math.PI / 3.2, 28, { x: 0, y: 1, z: 0 });
scene.camera = camera;
attachControl(camera, canvas, scene);

addToScene(scene, createHemisphericLight([0.2, 1, 0.3], 1.0));

// --- Scattered objects ------------------------------------------------------
// Give each object a matte-ish standard material of a given color.
function coloredMaterial(color: [number, number, number]) {
    const m = createStandardMaterial();
    m.diffuseColor = color;
    m.specularColor = [0.1, 0.1, 0.1];
    m.emissiveColor = [color[0] * 0.1, color[1] * 0.1, color[2] * 0.1];
    return m;
}

function place(mesh: Mesh, x: number, y: number, z: number, color: [number, number, number]) {
    mesh.position.set(x, y, z);
    mesh.material = coloredMaterial(color);
    addToScene(scene, mesh);
    return mesh;
}

// Small objects at known integer coordinates so the grid tells you where they are.
const redBox = place(createBox(engine, 1.5), -6, 0.75, -6, [0.85, 0.2, 0.2]);              // red box
place(createSphere(engine, { segments: 24, diameter: 1.8 }), 6, 0.9, 6, [0.2, 0.45, 0.9]); // blue sphere
const yellowCylinder = place(createCylinder(engine, { height: 2, diameter: 1.2 }), -6, 1.0, 6, [0.95, 0.8, 0.2]); // yellow cylinder
place(createTorus(engine, { diameter: 2, thickness: 0.5, tessellation: 32 }), 6, 0.75, -6, [0.6, 0.25, 0.8]); // purple torus
const centerBox = place(createBox(engine, 1), 0, 0.5, 0, [0.95, 0.55, 0.15]);              // orange box at origin
place(createSphere(engine, { segments: 20, diameter: 1.2 }), 3, 0.6, -4, [0.2, 0.8, 0.75]); // teal sphere

// --- Animations -------------------------------------------------------------
// Each motion is its own self-contained function: it captures the mesh's base
// position and registers a per-frame updater driven by elapsed seconds.

/** Bob straight up and down around the starting Y. */
function animateBob(scene: SceneContext, mesh: Mesh, amplitude = 1.5, period = 2) {
    const baseY = mesh.position.y;
    let t = 0;
    onBeforeRender(scene, (deltaMs) => {
        t += deltaMs / 1000;
        mesh.position.y = baseY + amplitude * Math.sin((t / period) * Math.PI * 2);
    });
}

/** Orbit a small circle in the XZ plane around the starting position. */
function animateCircle(scene: SceneContext, mesh: Mesh, radius = 1.5, period = 4) {
    const baseX = mesh.position.x;
    const baseZ = mesh.position.z;
    let t = 0;
    onBeforeRender(scene, (deltaMs) => {
        t += deltaMs / 1000;
        const angle = (t / period) * Math.PI * 2;
        mesh.position.x = baseX + radius * Math.cos(angle);
        mesh.position.z = baseZ + radius * Math.sin(angle);
    });
}

/** Trace a square path in the XZ plane around the starting position. */
function animateSquare(scene: SceneContext, mesh: Mesh, size = 3, period = 6) {
    const baseX = mesh.position.x;
    const baseZ = mesh.position.z;
    const half = size / 2;
    let t = 0;
    onBeforeRender(scene, (deltaMs) => {
        t += deltaMs / 1000;
        const p = (((t / period) % 1) + 1) % 1; // fraction 0..1 around the perimeter
        const seg = p * 4;
        const edge = Math.floor(seg);
        const f = seg - edge;
        let ox: number;
        let oz: number;
        switch (edge) {
            case 0: ox = -half + f * size; oz = -half; break;          // bottom edge, +X
            case 1: ox = half; oz = -half + f * size; break;           // right edge, +Z
            case 2: ox = half - f * size; oz = half; break;            // top edge, -X
            default: ox = -half; oz = half - f * size; break;          // left edge, -Z
        }
        mesh.position.x = baseX + ox;
        mesh.position.z = baseZ + oz;
    });
}

animateBob(scene, centerBox);
animateCircle(scene, redBox);
animateSquare(scene, yellowCylinder);

// 3. Register (after everything is added)
await registerScene(scene);

// 4. Start the render loop
await startEngine(engine);
