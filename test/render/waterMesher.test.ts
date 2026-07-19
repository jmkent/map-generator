import { describe, expect, it } from "vitest";

import { waterGeometry } from "../../src/render/meshers/waterMesher";

describe("waterGeometry", () => {
    it("emits one ribbon quad per river segment", () => {
        const geometry = waterGeometry([{
            kind: "river",
            width: 8,
            path: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
            leftBank: [{ x: 0, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 10 }],
            rightBank: [{ x: 0, y: -4 }, { x: 14, y: -4 }, { x: 14, y: 10 }],
        }], 0.03);

        expect(geometry.positions).toHaveLength(24);
        expect(geometry.indices).toHaveLength(12);
        expect([...geometry.positions].every(Number.isFinite)).toBe(true);
        expect([...geometry.normals].every(Number.isFinite)).toBe(true);
    });

    it("ear-clips a convex closed water body into n-2 triangles", () => {
        const geometry = waterGeometry([{ kind: "pond", polygon: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 5, y: 4 }, { x: 1, y: 5 }] }]);

        expect(geometry.positions).toHaveLength(4 * 3); // one vertex per ring point, no centroid
        expect(geometry.indices).toHaveLength((4 - 2) * 3);
        expect([...geometry.positions].every(Number.isFinite)).toBe(true);
    });

    it("triangulates a concave coastline without a centroid fan", () => {
        // A concave "C" shape: a fan from the centroid would produce inverted
        // triangles; ear clipping stays inside the polygon.
        const polygon = [
            { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 },
            { x: 2, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 0, y: 6 },
        ];
        const geometry = waterGeometry([{ kind: "coast", polygon }]);
        expect(geometry.positions).toHaveLength(polygon.length * 3);
        expect(geometry.indices).toHaveLength((polygon.length - 2) * 3);
        expect([...geometry.indices].every((i) => i >= 0 && i < polygon.length)).toBe(true);
        expect([...geometry.positions].every(Number.isFinite)).toBe(true);
    });
});
