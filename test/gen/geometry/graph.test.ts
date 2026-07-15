import { describe, expect, it } from "vitest";

import type { RoadNetwork } from "../../../src/gen/types";
import { componentCount, planarize, roadChains, type SegmentInput } from "../../../src/gen/geometry/graph";

describe("planarize", () => {
    it("splits an X crossing into a shared center node", () => {
        const segs: SegmentInput[] = [
            { a: { x: -1, y: 0 }, b: { x: 1, y: 0 }, kind: "primary", width: 3 },
            { a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, kind: "primary", width: 3 },
        ];
        const net = planarize(segs);
        // 4 endpoints + 1 shared center.
        expect(net.nodes).toHaveLength(5);
        // Each segment split into 2 → 4 edges.
        expect(net.edges).toHaveLength(4);
        expect(componentCount(net)).toBe(1);

        const center = net.nodes.find((n) => Math.abs(n.pos.x) < 1e-9 && Math.abs(n.pos.y) < 1e-9);
        expect(center).toBeDefined();
        const deg = net.edges.filter((e) => e.a === center!.id || e.b === center!.id).length;
        expect(deg).toBe(4);
    });

    it("handles a T-junction (endpoint on another segment's interior)", () => {
        const segs: SegmentInput[] = [
            { a: { x: -1, y: 0 }, b: { x: 1, y: 0 }, kind: "primary", width: 3 },
            { a: { x: 0, y: 0 }, b: { x: 0, y: 1 }, kind: "lane", width: 2 },
        ];
        const net = planarize(segs);
        expect(net.nodes).toHaveLength(4); // 3 endpoints of the tee + the top
        expect(net.edges).toHaveLength(3); // horizontal split in two + the stem
        expect(componentCount(net)).toBe(1);
    });

    it("merges coincident endpoints of a shared chain", () => {
        const segs: SegmentInput[] = [
            { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, kind: "primary", width: 3 },
            { a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, kind: "primary", width: 3 },
        ];
        const net = planarize(segs);
        expect(net.nodes).toHaveLength(3);
        expect(net.edges).toHaveLength(2);
    });

    it("leaves non-crossing segments as two components", () => {
        const segs: SegmentInput[] = [
            { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, kind: "primary", width: 3 },
            { a: { x: 0, y: 5 }, b: { x: 1, y: 5 }, kind: "primary", width: 3 },
        ];
        const net = planarize(segs);
        expect(net.nodes).toHaveLength(4);
        expect(componentCount(net)).toBe(2);
    });
});

describe("roadChains", () => {
    it("extracts one chain per span between junctions", () => {
        // A horizontal road split by a lane tee: two chains along it + the stem.
        const net: RoadNetwork = planarize([
            { a: { x: -1, y: 0 }, b: { x: 1, y: 0 }, kind: "primary", width: 3 },
            { a: { x: 0, y: 0 }, b: { x: 0, y: 1 }, kind: "lane", width: 2 },
        ]);
        const chains = roadChains(net);
        expect(chains).toHaveLength(3);
        expect(chains.filter((c) => c.kind === "primary")).toHaveLength(2);
        expect(chains.filter((c) => c.kind === "lane")).toHaveLength(1);
    });

    it("threads a straight chain through degree-2 nodes", () => {
        const net = planarize([
            { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, kind: "primary", width: 3 },
            { a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, kind: "primary", width: 3 },
            { a: { x: 2, y: 0 }, b: { x: 3, y: 0 }, kind: "primary", width: 3 },
        ]);
        const chains = roadChains(net);
        expect(chains).toHaveLength(1);
        expect(chains[0].points).toHaveLength(4);
    });
});
