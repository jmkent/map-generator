import { describe, expect, it } from "vitest";

import { renderModelSvg } from "../../src/debug/svgRenderer";
import { generateVillage } from "../../src/gen/pipeline";

describe("renderModelSvg", () => {
    it("produces a well-formed SVG with a boundary polygon", () => {
        const svg = renderModelSvg(generateVillage("village"));
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).toContain("<polygon");
        expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    });

    it("is deterministic for a given seed", () => {
        expect(renderModelSvg(generateVillage("village"))).toBe(
            renderModelSvg(generateVillage("village")),
        );
    });

    // Golden snapshots: a change in generation output surfaces as a reviewable
    // SVG diff. Regenerate intentionally with `vitest -u` after a deliberate change.
    for (const seed of ["village", "hamlet", "riverford"]) {
        it(`matches the golden render for seed "${seed}"`, async () => {
            await expect(renderModelSvg(generateVillage(seed))).toMatchFileSnapshot(
                `./__snapshots__/boundary-${seed}.svg`,
            );
        });
    }
});
