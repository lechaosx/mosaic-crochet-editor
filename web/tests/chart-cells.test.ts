import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PlanCell, initialize_round_pattern } from "@mosaic/wasm";
import { Store } from "@mosaic/logic/store";
import type { PatternState } from "@mosaic/logic/types";
import { CELL_CROSS, CELL_CROSS_B, CELL_WARNING, guidanceChange, packChartCells, repackChartCells } from "../src/chart-cells";
import { forEachPlanGlyph, packInstructionCoordinates } from "../src/instruction-coordinates";
import { rowSession } from "./_helpers";

// 3×2 chart: row 0 = A B A, row 1 = B hole B.
const W = 3, H = 2;
const pixels = new Uint8Array([1, 2, 1, 2, 0, 2]);
const at = (cells: Uint8Array, x: number, y: number) => cells[(y + 1) * (W + 2) + x + 1];
// A plan marking the given wrong cells.
const plan = (marks: [x: number, y: number, cell: number][]) => {
    const cells = new Uint8Array(W * H);
    for (const [x, y, cell] of marks) cells[y * W + x] = cell;
    return cells;
};

describe("packChartCells", () => {
    it("lays the yarns out inside an empty one-cell border", () => {
        const cells = packChartCells(pixels, W, H, plan([]), null);
        expect(cells).toEqual(new Uint8Array([
            0, 0, 0, 0, 0,
            0, 1, 2, 1, 0,
            0, 2, 0, 2, 0,
            0, 0, 0, 0, 0,
        ]));
    });

    it("marks ✕ on the outward cell in the yarn opposite to the one it lands on", () => {
        const cells = packChartCells(pixels, W, H, plan([
            [0, 1, PlanCell.Up],     // lands on A at (0, 0)
            [1, 1, PlanCell.Up],     // lands on B at (1, 0)
        ]), null);
        expect(at(cells, 0, 0)).toBe(1 | CELL_CROSS | CELL_CROSS_B);
        expect(at(cells, 1, 0)).toBe(2 | CELL_CROSS);
    });

    it("colours a ✕ in the border against its supporting cell", () => {
        const cells = packChartCells(pixels, W, H, plan([
            [0, 0, PlanCell.Up],     // supported by A
            [2, 1, PlanCell.Right],  // supported by B
        ]), null);
        expect(at(cells, 0, -1)).toBe(CELL_CROSS | CELL_CROSS_B);
        expect(at(cells, 3, 1)).toBe(CELL_CROSS);
    });

    it("omits a ✕ that lands on a hole", () => {
        const cells = packChartCells(pixels, W, H, plan([[1, 0, PlanCell.Down]]), null);
        expect(at(cells, 1, 1)).toBe(0);
    });

    it("marks ! on the outward cell, including the border and holes", () => {
        const cells = packChartCells(pixels, W, H, plan([
            [0, 0, PlanCell.Invalid | PlanCell.Left],
            [1, 0, PlanCell.Invalid | PlanCell.Down],
            [2, 1, PlanCell.Invalid | PlanCell.Up],
        ]), null);
        expect(at(cells, -1, 0)).toBe(CELL_WARNING);
        expect(at(cells, 1, 1)).toBe(CELL_WARNING);
        expect(at(cells, 2, 0)).toBe(1 | CELL_WARNING);
    });

    it("marks ✕ or ! on exactly the outward cells of the plan's glyphs", () => {
        // Hole-free charts, so every ✕ has a yarn to contrast with.
        const chart = fc.oneof(
            fc.record({ W: fc.integer({ min: 1, max: 8 }), H: fc.integer({ min: 1, max: 8 }) })
                .map(({ W, H }): PatternState => ({ mode: "row", canvasWidth: W, canvasHeight: H })),
            fc.record({ W: fc.integer({ min: 1, max: 8 }), H: fc.integer({ min: 1, max: 8 }) })
                .map(({ W, H }): PatternState => ({ mode: "round", canvasWidth: W, canvasHeight: H,
                    virtualWidth: W, virtualHeight: H, offsetX: 0, offsetY: 0, rounds: 4 })),
        );
        fc.assert(fc.property(chart, fc.array(fc.constantFrom<1 | 2>(1, 2), { minLength: 64, maxLength: 64 }),
            (pattern, yarns) => {
                const { canvasWidth: W, canvasHeight: H } = pattern;
                const pixels = new Uint8Array(yarns.slice(0, W * H));
                const plan = new Store(rowSession(W, H, { pattern, pixels })).plan.cells;
                const cells = packChartCells(pixels, W, H, plan, null);
                const stride = W + 2, crosses = new Set<number>(), warnings = new Set<number>();
                forEachPlanGlyph(plan, W, (invalid, x, y) => (invalid ? warnings : crosses).add((y + 1) * stride + x + 1));
                cells.forEach((cell, index) => {
                    const x = index % stride - 1, y = Math.floor(index / stride) - 1;
                    const inside = x >= 0 && x < W && y >= 0 && y < H;
                    expect(cell & 3).toBe(inside ? pixels[y * W + x] : 0);
                    expect((cell & CELL_CROSS) !== 0).toBe(crosses.has(index));
                    expect((cell & CELL_WARNING) !== 0).toBe(warnings.has(index));
                });
            },
        ), { numRuns: 500 });
    });

    it("keeps only the glyphs whose outward cell the guidance includes", () => {
        const cells = packChartCells(pixels, W, H, plan([
            [0, 1, PlanCell.Up],
            [2, 1, PlanCell.Invalid | PlanCell.Up],
        ]), packInstructionCoordinates([2, 0], W));
        expect(at(cells, 0, 0)).toBe(1);
        expect(at(cells, 2, 0)).toBe(1 | CELL_WARNING);
    });
});

describe("repackChartCells", () => {
    const chart = fc.oneof(
        fc.record({ W: fc.integer({ min: 1, max: 8 }), H: fc.integer({ min: 1, max: 8 }) })
            .map(({ W, H }): PatternState => ({ mode: "row", canvasWidth: W, canvasHeight: H })),
        fc.record({ W: fc.integer({ min: 1, max: 8 }), H: fc.integer({ min: 1, max: 8 }), rounds: fc.integer({ min: 1, max: 5 }) })
            .map(({ W, H, rounds }): PatternState => ({ mode: "round", canvasWidth: W, canvasHeight: H,
                virtualWidth: W, virtualHeight: H, offsetX: 0, offsetY: 0, rounds })),
    );
    const edits = fc.array(fc.record({ x: fc.nat(), y: fc.nat(), yarn: fc.constantFrom<1 | 2>(1, 2) }), { minLength: 1, maxLength: 10 });

    it("rewriting each change region in place keeps the cells of a full pack, within the bytes it reports", () => {
        fc.assert(fc.property(chart, edits, (pattern, steps) => {
            const { canvasWidth: W, canvasHeight: H } = pattern;
            const pixels = pattern.mode === "row" ? undefined
                : initialize_round_pattern(W, H, W, H, 0, 0, pattern.rounds);
            const store = new Store(rowSession(W, H, { pattern, ...(pixels && { pixels }) }));
            const cells = packChartCells(store.visible, W, H, store.plan.cells, null);
            for (const { x, y, yarn } of steps) {
                const version = store.planVersion;
                store.commit(state => {
                    const next = state.pixels.slice();
                    if (next[(y % H) * W + x % W] !== 0) next[(y % H) * W + x % W] = yarn;
                    state.pixels = next;
                });
                const change = store.planChangeSince(version);
                if (change === "all") throw new Error("A pixel commit rebuilt the plan");
                const before = cells.slice();
                if (change) {
                    const [start, end] = repackChartCells(cells, store.visible, W, H, store.plan.cells, null, change);
                    cells.forEach((cell, index) => {
                        if (cell !== before[index]) expect(index >= start && index < end).toBe(true);
                    });
                }
                expect(cells).toEqual(packChartCells(store.visible, W, H, store.plan.cells, null));
            }
        }), { numRuns: 500 });
    });

    const cellList = fc.array(fc.record({ x: fc.nat(), y: fc.nat() }), { maxLength: 12 });

    it("rewriting the region of a guidance change keeps the cells of a full pack with the new guidance", () => {
        const edit = fc.record({ x: fc.nat(), y: fc.nat(), yarn: fc.constantFrom<1 | 2>(1, 2) });
        const yarns = fc.array(fc.constantFrom<1 | 2>(1, 2), { minLength: 64, maxLength: 64 });
        fc.assert(fc.property(chart, yarns, cellList, cellList, edit, (pattern, yarns, before, after, { x, y, yarn }) => {
            const { canvasWidth: W, canvasHeight: H } = pattern;
            const pixels = pattern.mode === "row" ? new Uint8Array(W * H).fill(1)
                : initialize_round_pattern(W, H, W, H, 0, 0, pattern.rounds);
            pixels.forEach((value, i) => { if (value !== 0) pixels[i] = yarns[i]; });
            const store = new Store(rowSession(W, H, { pattern, pixels }));
            const guidance = (cells: { x: number; y: number }[]) =>
                packInstructionCoordinates(cells.flatMap(({ x, y }) => [x % (W + 2) - 1, y % (H + 2) - 1]), W);
            const from = guidance(before), to = guidance(after);
            const cells = packChartCells(store.visible, W, H, store.plan.cells, from);
            const version = store.planVersion;
            store.commit(state => {
                const next = state.pixels.slice();
                if (next[(y % H) * W + x % W] !== 0) next[(y % H) * W + x % W] = yarn;
                state.pixels = next;
            });
            const change = guidanceChange(store.planChangeSince(version), from, to, W, H);
            if (change === "all") throw new Error("A guidance change between guided rows repacked everything");
            if (change) repackChartCells(cells, store.visible, W, H, store.plan.cells, to, change);
            expect(cells).toEqual(packChartCells(store.visible, W, H, store.plan.cells, to));
        }), { numRuns: 500 });
    });
});
