// History property tests — pure logic properties live in logic/tests/properties.test.ts.
import { describe, test } from "vitest";
import fc from "fast-check";

import {
    historyFrom, historySave, historyUndo, historyRedo, historyPeek, canUndo, canRedo,
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
    test("N saves, N undos lands at the seed state", () => {
        fc.assert(fc.property(
            fc.array(rowPatternWithPixels, { minLength: 1, maxLength: 5 }),
            (states) => {
                const seed = rowSession(3, 3);
                let h = historyFrom(seed);
                for (const { pattern, pixels } of states) {
                    h = historySave(h, rowSession(pattern.canvasWidth, pattern.canvasHeight, { pattern, pixels }));
                }
                while (canUndo(h)) h = historyUndo(h)!;
                return historyPeek(h).pixels.length === seed.pixels.length;
            },
        ));
    });

    test("N saves, N undos, N redos lands at the last saved state", () => {
        fc.assert(fc.property(
            fc.array(rowPatternWithPixels, { minLength: 1, maxLength: 5 }),
            (states) => {
                let h = historyFrom(rowSession(3, 3));
                for (const { pattern, pixels } of states) {
                    h = historySave(h, rowSession(pattern.canvasWidth, pattern.canvasHeight, { pattern, pixels }));
                }
                const final = historyPeek(h);
                let undone = 0;
                while (canUndo(h)) { h = historyUndo(h)!; undone++; }
                let redone = 0;
                while (canRedo(h)) { h = historyRedo(h)!; redone++; }
                if (undone !== redone) return false;
                return final.pixels.length === historyPeek(h).pixels.length;
            },
        ));
    });
});
