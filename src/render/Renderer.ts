// Engine/scene lifecycle for the map stage. Consumes a MapModel and renders it
// at a framed, fixed-angle view. M1 draws the boundary polygon as a flat ground
// patch over a reference grid; later milestones add road/building/terrain meshers.

import {
    createEngine,
    createSceneContext,
    createHemisphericLight,
    createStandardMaterial,
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
import { createStageCamera, applyStageFraming } from "./camera";
import { boundaryGeometry } from "./meshers/boundaryMesher";
import { boundaryOutlineGeometry } from "./meshers/boundaryOutlineMesher";
import { roadGeometry } from "./meshers/roadMesher";
import { buildingInstances } from "./meshers/buildingMesher";
import { waterGeometry } from "./meshers/waterMesher";
import { terrainGeometry } from "./meshers/terrainMesher";

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
    // Grass fills the scene, so any sliver beyond the terrain reads as field too.
    scene.clearColor = { r: 0.153, g: 0.435, b: 0.169, a: 1.0 };

    const bounds = model.mapBounds;

    // Terrain is the grass surface: one continuous green across the whole extent,
    // matching the SVG renderer. Relief comes from the raised mesh, not the color.
    const terrainGeo = terrainGeometry(model.terrain);
    const terrainMesh = createMeshFromData(engine, "terrain", terrainGeo.positions, terrainGeo.normals, terrainGeo.indices);
    const terrainMat = createStandardMaterial();
    terrainMat.diffuseColor = [0.153, 0.435, 0.169];
    terrainMat.specularColor = [0.02, 0.02, 0.02];
    terrainMesh.material = terrainMat;
    terrainMesh.pickable = false;
    addToScene(scene, terrainMesh);

    // Village extent as a dashed outline over the grass, not a filled patch, so
    // the boundary reads without hiding what sits inside it.
    const outlineGeo = boundaryOutlineGeometry(model.boundary, 0.1);
    if (outlineGeo.indices.length > 0) {
        const outlineMesh = createMeshFromData(engine, "boundary-outline", outlineGeo.positions, outlineGeo.normals, outlineGeo.indices);
        const outlineMat = createStandardMaterial();
        outlineMat.diffuseColor = [0.91, 0.925, 0.945];
        outlineMat.emissiveColor = [0.55, 0.58, 0.62];
        outlineMat.specularColor = [0.02, 0.02, 0.02];
        outlineMesh.material = outlineMat;
        outlineMesh.pickable = false;
        addToScene(scene, outlineMesh);
    }

    // Civic greens are reserved land: render them above the general ground and
    // below roads so their placement is legible in the interactive view.
    for (const [index, space] of model.civicSpaces.entries()) {
        const civicGeo = boundaryGeometry(space.polygon, 0.1);
        const civicMesh = createMeshFromData(engine, `civic-${index}`, civicGeo.positions, civicGeo.normals, civicGeo.indices);
        const civicMat = createStandardMaterial();
        civicMat.diffuseColor = [0.3, 0.58, 0.32];
        civicMat.specularColor = [0.02, 0.02, 0.02];
        civicMesh.material = civicMat;
        civicMesh.pickable = false;
        addToScene(scene, civicMesh);
    }

    // Keep water clearly above the terrain depth plane, while leaving roads on
    // top so bridge crossings retain their visual hierarchy.
    const waterGeo = waterGeometry(model.water, 0.12);
    if (waterGeo.indices.length > 0) {
        const waterMesh = createMeshFromData(engine, "water", waterGeo.positions, waterGeo.normals, waterGeo.indices);
        const waterMat = createStandardMaterial();
        // Pale blue reads with high contrast against the grass. Water is drawn
        // unlit, so its visible color is the emissive.
        waterMat.diffuseColor = [0.373, 0.659, 0.827];
        waterMat.emissiveColor = [0.373, 0.659, 0.827];
        waterMat.specularColor = [0.25, 0.5, 0.8];
        waterMat.backFaceCulling = false;
        waterMat.disableLighting = true;
        waterMesh.material = waterMat;
        waterMesh.pickable = false;
        addToScene(scene, waterMesh);
    }

    // Roads as flat ribbons, above the boundary patch.
    const roadGeo = roadGeometry(model.roads, 0.14);
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
