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
    createBox,
    addThinInstance,
    mat4Compose,
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
import { roadGeometry } from "./meshers/roadMesher";
import { buildingInstances } from "./meshers/buildingMesher";
import { waterGeometry } from "./meshers/waterMesher";

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

    const bounds = model.mapBounds;
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

    // Civic greens are reserved land: render them above the general ground and
    // below roads so their placement is legible in the interactive view.
    for (const [index, space] of model.civicSpaces.entries()) {
        const civicGeo = boundaryGeometry(space.polygon, 0.03);
        const civicMesh = createMeshFromData(engine, `civic-${index}`, civicGeo.positions, civicGeo.normals, civicGeo.indices);
        const civicMat = createStandardMaterial();
        civicMat.diffuseColor = [0.3, 0.58, 0.32];
        civicMat.specularColor = [0.02, 0.02, 0.02];
        civicMesh.material = civicMat;
        civicMesh.pickable = false;
        addToScene(scene, civicMesh);
    }

    // Water lies above ground but below roads so river crossings remain visible.
    const waterGeo = waterGeometry(model.water, 0.035);
    if (waterGeo.indices.length > 0) {
        const waterMesh = createMeshFromData(engine, "water", waterGeo.positions, waterGeo.normals, waterGeo.indices);
        const waterMat = createStandardMaterial();
        waterMat.diffuseColor = [0.12, 0.42, 0.68];
        waterMat.specularColor = [0.15, 0.2, 0.24];
        waterMesh.material = waterMat;
        waterMesh.pickable = false;
        addToScene(scene, waterMesh);
    }

    // Roads as flat ribbons, above the boundary patch.
    const roadGeo = roadGeometry(model.roads, 0.04);
    if (roadGeo.indices.length > 0) {
        const roadMesh = createMeshFromData(engine, "roads", roadGeo.positions, roadGeo.normals, roadGeo.indices);
        const roadMat = createStandardMaterial();
        roadMat.diffuseColor = [0.85, 0.77, 0.54];
        roadMat.specularColor = [0.02, 0.02, 0.02];
        roadMesh.material = roadMat;
        roadMesh.pickable = false;
        addToScene(scene, roadMesh);
    }

    // Houses as thin instances of a unit box.
    const instances = buildingInstances(model.buildings);
    if (instances.length > 0) {
        const box = createBox(engine, 1);
        const houseMat = createStandardMaterial();
        houseMat.diffuseColor = [0.72, 0.6, 0.46];
        houseMat.specularColor = [0.05, 0.05, 0.05];
        box.material = houseMat;
        for (const t of instances) {
            const half = t.rotationY / 2;
            const matrix = mat4Compose(
                t.position[0], t.position[1], t.position[2],
                0, Math.sin(half), 0, Math.cos(half),
                t.scale[0], t.scale[1], t.scale[2],
            );
            addThinInstance(box, matrix);
        }
        addToScene(scene, box);
    }

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
