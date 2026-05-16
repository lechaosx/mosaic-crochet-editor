// @vitest-environment jsdom
// History property tests — pure logic properties live in logic/tests/properties.test.ts.
import { describe, test, beforeEach } from "vitest";
import fc from "fast-check";

import {
    historyReset, historySave, historyUndo, historyRedo, historyPeek,
} from "../src/history";
import { rowSession } from "./_helpers";
import type { PatternState } from "@mosaic/logic/types";

const rowPattern = fc.tuple(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 2, max: 12 }))
    .map(([W, H]): PatternState => ({ mode: "row", canvasWidth: W, canvasHeight: H }));

function rowPixelsOf(W: number, H: number) {
    return fc.array(fc.constantFrom<1 | 2>(1, 2), { minLength: W * H, maxLength: W * H })
        .map(arr => Uint8Array.from(arr));
}

const rowPatternWithPixels = rowPattern.chain(p =>
    rowPixelsOf(p.canvasWidth, p.canvasHeight).map(pixels => ({ pattern: p, pixels }))
);

describe("history undo/redo balance", () => {
    beforeEach(() => { localStorage.clear(); });

    test("N saves, N undos lands at the seed state", () => {
        fc.assert(fc.property(
            fc.array(rowPatternWithPixels, { minLength: 1, maxLength: 5 }),
            (states) => {
                localStorage.clear();
                const seed = rowSession(3, 3);
                historyReset(seed);
                for (const { pattern, pixels } of states) {
                    historySave(rowSession(pattern.canvasWidth, pattern.canvasHeight, { pattern, pixels }));
                }
                while (historyUndo()) { /* empty */ }
                const peeked = historyPeek();
                return peeked !== null && peeked.pixels.length === seed.pixels.length;
            },
        ));
    });

    test("N saves, N undos, N redos lands at the last saved state", () => {
        fc.assert(fc.property(
            fc.array(rowPatternWithPixels, { minLength: 1, maxLength: 5 }),
            (states) => {
                localStorage.clear();
                historyReset(rowSession(3, 3));
                for (const { pattern, pixels } of states) {
                    historySave(rowSession(pattern.canvasWidth, pattern.canvasHeight, { pattern, pixels }));
                }
                const final = historyPeek();
                let undone = 0;
                while (historyUndo()) undone++;
                let redone = 0;
                while (historyRedo()) redone++;
                if (undone !== redone) return false;
                const after = historyPeek();
                if (!final || !after) return false;
                return final.pixels.length === after.pixels.length;
            },
        ));
    });
});
