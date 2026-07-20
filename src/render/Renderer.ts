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
import { TERRAIN_BASE_Y, terrainBandMeshes, mapFrameGeometry } from "./meshers/terrainMesher";
import { BACKGROUND, MAP_FRAME, hexToRgb } from "./palette";
import type { RenderDiagnostics } from "../app/renderDiagnostics";

const hexColor = (h: string) => ({ ...hexToRgb(h), a: 1.0 });
const hexRgb = (h: string): [number, number, number] => { const c = hexToRgb(h); return [c.r, c.g, c.b]; };
const FRAME_Y = 0.94;
const CIVIC_Y = 0.95;
const OUTLINE_Y = 0.96;
const WATER_Y = 0.97;
const ROAD_Y = 1.0;

export interface Renderer {
    engine: EngineContext;
    scene: SceneContext;
    camera: ArcRotateCamera;
    diagnostics: RenderDiagnostics;
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
    // The non-map field of view is a dark slate so the framed, colored map stands
    // out — matching the SVG renderer's background.
    scene.clearColor = hexColor(BACKGROUND);

    const bounds = model.mapBounds;

    // Terrain surface, colored by elevation: one flat-colored mesh per elevation
    // band (lite's StandardMaterial has no per-vertex color path). Relief comes from
    // the raised geometry; the band colors give the topographic gradient.
    const terrainBands = terrainBandMeshes(model.terrain);
    for (const [index, { color, geometry }] of terrainBands.entries()) {
        const bandMesh = createMeshFromData(engine, `terrain-band-${index}`, geometry.positions, geometry.normals, geometry.indices);
        const bandMat = createStandardMaterial();
        bandMat.diffuseColor = hexRgb(color);
        bandMat.emissiveColor = hexRgb(color);
        bandMat.specularColor = [0.02, 0.02, 0.02];
        bandMat.disableLighting = true;
        bandMesh.material = bandMat;
        bandMesh.pickable = false;
        addToScene(scene, bandMesh);
    }

    // A solid frame around the map extent, in the margin just outside the terrain.
    const frameGeo = mapFrameGeometry(bounds, Math.max((bounds.maxX - bounds.minX) * 0.015, 4), FRAME_Y);
    const frameMesh = createMeshFromData(engine, "map-frame", frameGeo.positions, frameGeo.normals, frameGeo.indices);
    const frameMat = createStandardMaterial();
    frameMat.diffuseColor = hexRgb(MAP_FRAME);
    frameMat.emissiveColor = hexRgb(MAP_FRAME);
    frameMat.specularColor = [0.02, 0.02, 0.02];
    frameMat.disableLighting = true;
    frameMesh.material = frameMat;
    frameMesh.pickable = false;
    addToScene(scene, frameMesh);

    // Village extent as a dashed outline over the grass, not a filled patch, so
    // the boundary reads without hiding what sits inside it.
    const outlineGeo = boundaryOutlineGeometry(model.boundary, OUTLINE_Y);
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
        const civicGeo = boundaryGeometry(space.polygon, CIVIC_Y);
        const civicMesh = createMeshFromData(engine, `civic-${index}`, civicGeo.positions, civicGeo.normals, civicGeo.indices);
        const civicMat = createStandardMaterial();
        civicMat.diffuseColor = [0.3, 0.58, 0.32];
        civicMat.specularColor = [0.02, 0.02, 0.02];
        civicMesh.material = civicMat;
        civicMesh.pickable = false;
        addToScene(scene, civicMesh);
    }

    // Rivers/ponds/lakes are flat surface water above the relief; the coast (the
    // sea) is left to the terrain gradient, which already shows it by depth — a flat
    // overlay would hide that. Roads stay on top so bridge crossings read.
    const overlayWater = model.water.filter((body) => body.kind !== "coast");
    const waterGeo = waterGeometry(overlayWater, WATER_Y);
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
    const roadGeo = roadGeometry(model.roads, ROAD_Y);
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
    const instances = buildingInstances(model.buildings, TERRAIN_BASE_Y);
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
        diagnostics: {
            terrain: {
                bandCount: terrainBands.length,
                colors: terrainBands.map(({ color }) => color),
                cellCount: (model.terrain.resolution - 1) ** 2,
                indexCount: terrainBands.reduce((count, { geometry }) => count + geometry.indices.length, 0),
            },
            water: {
                generatedKinds: model.water.map((body) => body.kind),
                overlayKinds: overlayWater.map((body) => body.kind),
                indexCount: waterGeo.indices.length,
            },
        },
        dispose() {
            window.removeEventListener("resize", onResize);
        },
    };
}
