import { describe, expect, it } from "vitest";

import { geometryDiagnostics } from "../../src/app/geometryDiagnostics";
import { generateVillage } from "../../src/gen/pipeline";

describe("geometryDiagnostics", () => {
    it("reports whether a river was generated alongside core geometry counts", () => {
        const withRiver = geometryDiagnostics(generateVillage("diagnostics", { riverChance: 1 }));
        const withoutRiver = geometryDiagnostics(generateVillage("diagnostics", { riverChance: 0 }));

        expect(withRiver.some((line) => line.startsWith("river: ") && !line.startsWith("river: none"))).toBe(true);
        expect(withoutRiver.some((line) => line.startsWith("river: none; standing water: "))).toBe(true);
        expect(withRiver.some((line) => line.startsWith("roads: "))).toBe(true);
        expect(withRiver.some((line) => line.startsWith("parcels: "))).toBe(true);
    });
});
