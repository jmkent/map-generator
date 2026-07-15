// Minimal on-canvas HUD. M0 shows only the active seed; controls (regenerate,
// sliders) arrive in M5. Kept as a thin DOM adapter — state/string logic lives
// in app/urlState.ts.

export interface Hud {
    root: HTMLElement;
    setSeed(seed: string): void;
}

export function createHud(parent: HTMLElement = document.body): Hud {
    const root = document.createElement("div");
    root.className = "hud";

    const seedEl = document.createElement("span");
    seedEl.className = "hud__seed";
    root.appendChild(seedEl);

    parent.appendChild(root);

    return {
        root,
        setSeed(seed: string) {
            seedEl.textContent = `seed: ${seed}`;
        },
    };
}
