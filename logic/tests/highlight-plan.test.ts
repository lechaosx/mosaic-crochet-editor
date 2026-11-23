import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { initialize_round_pattern, initialize_row_pattern } from "@mosaic/wasm";
import { changedCells, computeHighlightPlan, updateHighlightPlan } from "../src/highlight-plan";
import type { PatternState } from "../src/types";

const chart = fc.oneof(
    fc.record({ W: fc.integer({ min: 1, max: 9 }), H: fc.integer({ min: 1, max: 9 }) })
        .map(({ W, H }): PatternState => ({ mode: "row", canvasWidth: W, canvasHeight: H })),
    fc.record({
        W: fc.integer({ min: 1, max: 9 }), H: fc.integer({ min: 1, max: 9 }),
        extraW: fc.integer({ min: 0, max: 3 }), extraH: fc.integer({ min: 0, max: 3 }),
        offsetX: fc.nat(), offsetY: fc.nat(), rounds: fc.integer({ min: 1, max: 6 }),
    }).map(({ W, H, extraW, extraH, offsetX, offsetY, rounds }): PatternState => ({
        mode: "round", canvasWidth: W, canvasHeight: H, virtualWidth: W + extraW, virtualHeight: H + extraH,
        offsetX: offsetX % (extraW + 1), offsetY: offsetY % (extraH + 1), rounds,
    })),
);

function natural(p: PatternState): Uint8Array {
    return p.mode === "row"
        ? initialize_row_pattern(p.canvasWidth, p.canvasHeight)
        : initialize_round_pattern(p.canvasWidth, p.canvasHeight, p.virtualWidth, p.virtualHeight,
            p.offsetX, p.offsetY, p.rounds);
}

// Yarn writes over random rectangles, as stroke steps make them: values are
// taken in order and holes stay holes.
const edits = fc.array(fc.record({
    x: fc.nat(), y: fc.nat(), width: fc.integer({ min: 1, max: 4 }), height: fc.integer({ min: 1, max: 4 }),
    yarns: fc.array(fc.constantFrom(1, 2), { minLength: 16, maxLength: 16 }),
}), { minLength: 1, maxLength: 8 });

describe("highlight plan updates", () => {
    test("updating the cells around each edit matches recomputing the whole plan", () => {
        fc.assert(fc.property(chart, edits, (pattern, steps) => {
            const { canvasWidth: W, canvasHeight: H } = pattern;
            let pixels = natural(pattern);
            const plan = computeHighlightPlan(pattern, pixels);
            for (const step of steps) {
                const next = pixels.slice();
                let k = 0;
                for (let y = step.y % H; y < Math.min(H, step.y % H + step.height); y++) {
                    for (let x = step.x % W; x < Math.min(W, step.x % W + step.width); x++) {
                        if (next[y * W + x] !== 0) next[y * W + x] = step.yarns[k++];
                    }
                }
                const changed = changedCells(pixels, next, W);
                if (changed) updateHighlightPlan(plan, pattern, next, changed);
                expect(plan).toEqual(computeHighlightPlan(pattern, next));
                pixels = next;
            }
        }), { numRuns: 500 });
    });

    test("changed cells are bounded exactly, at any byte alignment", () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 9 }), fc.integer({ min: 0, max: 3 }),
            fc.array(fc.nat(), { maxLength: 40 }),
            (W, H, offset, picks) => {
                const buffer = new Uint8Array(W * H + offset);
                const before = buffer.subarray(offset);
                const after = before.slice();
                const cells = picks.map(pick => pick % (W * H));
                for (const index of cells) after[index] = 2;
                const xs = cells.map(index => index % W), ys = cells.map(index => Math.floor(index / W));
                expect(changedCells(before, after, W)).toEqual(cells.length === 0 ? null : {
                    x: Math.min(...xs), y: Math.min(...ys),
                    width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1,
                });
            },
        ), { numRuns: 500 });
    });
});
