import { describe, expect, it } from "vitest";

import { waterGeometry } from "../../src/render/meshers/waterMesher";

describe("waterGeometry", () => {
    it("emits one ribbon quad per river segment", () => {
        const geometry = waterGeometry([{ kind: "river", width: 8, path: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }], 0.03);

        expect(geometry.positions).toHaveLength(24);
        expect(geometry.indices).toHaveLength(12);
        expect([...geometry.positions].every(Number.isFinite)).toBe(true);
        expect([...geometry.normals].every(Number.isFinite)).toBe(true);
    });
});
