// Engine/scene lifecycle for the map stage. Consumes a MapModel and renders it
// at a framed, fixed-angle view. M1 draws the boundary polygon as a flat ground
// patch over a reference grid; later milestones add road/building/terrain meshers.

import {
    createEngine,
    createSceneContext,
    createHemisphericLight,
    createGround,
    createStandardMaterial,
    createGridMaterial,
    createMeshFromData,
    addToScene,
    registerScene,
    startEngine,
    type EngineContext,
    type SceneContext,
    type ArcRotateCamera,
} from "@babylonjs/lite";

import type { MapModel } from "../gen/types";
import { boundsCenter, boundsSize } from "../gen/types";
import { createStageCamera, applyStageFraming } from "./camera";
import { boundaryGeometry } from "./meshers/boundaryMesher";

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

/** Build the stage: engine, scene, reference grid, boundary patch, framed camera. */
export async function createRenderer(canvas: HTMLCanvasElement, model: MapModel): Promise<Renderer> {
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.05, g: 0.06, b: 0.08, a: 1.0 };

    const bounds = model.bounds;
    const center = boundsCenter(bounds);
    const { width, height } = boundsSize(bounds);

    // Transparent reference grid across the model bounds, at y=0.
    const grid = createGround(engine, { width, height });
    grid.position.set(center.x, 0, center.y);
    grid.material = createGridMaterial({
        mainColor: [0.08, 0.1, 0.13],
        lineColor: [0.35, 0.4, 0.48],
        gridRatio: 10,
        majorUnitFrequency: 5,
        minorUnitVisibility: 0.5,
        opacity: 0.6,
    });
    grid.pickable = false;
    addToScene(scene, grid);

    // Boundary polygon as a flat green patch, just above the grid.
    const geo = boundaryGeometry(model.boundary, 0.02);
    const boundaryMesh = createMeshFromData(engine, "boundary", geo.positions, geo.normals, geo.indices);
    const boundaryMat = createStandardMaterial();
    boundaryMat.diffuseColor = [0.15, 0.45, 0.2];
    boundaryMat.specularColor = [0.03, 0.03, 0.03];
    boundaryMesh.material = boundaryMat;
    addToScene(scene, boundaryMesh);

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
