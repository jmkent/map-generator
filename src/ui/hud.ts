// Minimal on-canvas HUD. Kept as a thin DOM adapter — geometry summaries are
// derived outside the DOM layer so they can be tested without a browser.

export interface Hud {
    root: HTMLElement;
    setSeed(seed: string): void;
    setDiagnostics(lines: readonly string[]): void;
}

export function createHud(parent: HTMLElement = document.body): Hud {
    const root = document.createElement("div");
    root.className = "hud";

    const seedEl = document.createElement("div");
    seedEl.className = "hud__seed";
    root.appendChild(seedEl);
    const diagnosticsEl = document.createElement("ul");
    diagnosticsEl.className = "hud__diagnostics";
    root.appendChild(diagnosticsEl);

    parent.appendChild(root);

    return {
        root,
        setSeed(seed: string) {
            seedEl.textContent = `seed: ${seed}`;
        },
        setDiagnostics(lines: readonly string[]) {
            diagnosticsEl.replaceChildren(...lines.map((line) => {
                const item = document.createElement("li");
                item.textContent = line;
                return item;
            }));
        },
    };
}
