// Serializable evidence that the Babylon adapter submitted the expected scene
// data. Browser automation reads this after the first frame to distinguish a
// generation/meshing failure from a GPU/material presentation failure.

export interface RenderDiagnostics {
    terrain: {
        bandCount: number;
        colors: string[];
        cellCount: number;
        indexCount: number;
    };
    water: {
        generatedKinds: string[];
        overlayKinds: string[];
        indexCount: number;
    };
}

export interface BrowserRenderDiagnostics {
    status: "ready" | "error";
    seed: string;
    renderer?: RenderDiagnostics;
    error?: string;
}
