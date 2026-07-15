// Engine/scene lifecycle for the map stage. Consumes a plain Bounds and sets up
// a framed, fixed-angle view over an empty ground + measurement grid. Future
// milestones will add meshers that consume a MapModel; M0 renders only the stage.

import {
    createEngine,
    createSceneContext,
    createHemisphericLight,
    createGround,
    createStandardMaterial,
    createGridMaterial,
    addToScene,
    registerScene,
    startEngine,
    type EngineContext,
    type SceneContext,
    type ArcRotateCamera,
} from "@babylonjs/lite";

import type { Bounds } from "../gen/types";
import { boundsCenter, boundsSize } from "../gen/types";
import { createStageCamera, applyStageFraming } from "./camera";

export interface Renderer {
    engine: EngineContext;
    scene: SceneContext;
    camera: ArcRotateCamera;
    dispose(): void;
}

function canvasAspect(canvas: HTMLCanvasElement): number {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    return w / h;
}

/** Build the stage: engine, scene, ground+grid framed by a fixed-angle camera. */
export async function createRenderer(canvas: HTMLCanvasElement, bounds: Bounds): Promise<Renderer> {
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.05, g: 0.06, b: 0.08, a: 1.0 };

    const center = boundsCenter(bounds);
    const { width, height } = boundsSize(bounds);

    // Solid ground patch covering the stage.
    const ground = createGround(engine, { width, height });
    ground.position.set(center.x, 0, center.y);
    const groundMat = createStandardMaterial();
    groundMat.diffuseColor = [0.15, 0.55, 0.2];
    groundMat.specularColor = [0.05, 0.05, 0.05];
    ground.material = groundMat;
    addToScene(scene, ground);

    // Transparent measurement grid floating just above the ground.
    const grid = createGround(engine, { width, height });
    grid.position.set(center.x, 0.02, center.y);
    grid.material = createGridMaterial({
        mainColor: [0, 0, 0],
        lineColor: [0.9, 0.95, 1.0],
        gridRatio: 10,
        majorUnitFrequency: 5,
        minorUnitVisibility: 0.4,
        opacity: 0.85,
    });
    grid.pickable = false;
    addToScene(scene, grid);

    addToScene(scene, createHemisphericLight([0.2, 1, 0.3], 1.0));

    const camera = createStageCamera(bounds, canvasAspect(canvas));
    scene.camera = camera;

    const onResize = () => applyStageFraming(camera, bounds, canvasAspect(canvas));
    window.addEventListener("resize", onResize);

    await registerScene(scene);
    await startEngine(engine);

    return {
        engine,
        scene,
        camera,
        dispose() {
            window.removeEventListener("resize", onResize);
        },
    };
}
