import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The generator must be a pure function of its seed: no ambient entropy or clock
// reads anywhere under src/gen (see PLAN.md §5). This guards that invariant.

const GEN_DIR = fileURLToPath(new URL("../../src/gen", import.meta.url));
const FORBIDDEN = [/\bMath\.random\b/, /\bDate\.now\b/, /performance\.now\b/, /\bnew Date\b/];

/** Strip comments so a comment *mentioning* an entropy source isn't a false hit.
 *  Line comments preceded by ':' (e.g. "http://") are left intact. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function tsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...tsFiles(full));
        else if (entry.endsWith(".ts")) out.push(full);
    }
    return out;
}

describe("gen/ purity", () => {
    const files = tsFiles(GEN_DIR);

    it("scans a non-trivial number of files", () => {
        expect(files.length).toBeGreaterThan(3);
    });

    for (const file of files) {
        it(`${file.slice(file.indexOf("src/gen"))} uses no ambient entropy or clock`, () => {
            const src = stripComments(readFileSync(file, "utf8"));
            for (const pattern of FORBIDDEN) {
                expect(pattern.test(src), `matched ${pattern}`).toBe(false);
            }
        });
    }
});
