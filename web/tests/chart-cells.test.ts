import { describe, expect, it } from "vitest";
import { PlanDir, PlanType } from "@mosaic/wasm";
import { CELL_CROSS, CELL_CROSS_B, CELL_WARNING, packChartCells } from "../src/chart-cells";
import { packInstructionCoordinates } from "../src/instruction-coordinates";

// 3×2 chart: row 0 = A B A, row 1 = B hole B.
const W = 3, H = 2;
const pixels = new Uint8Array([1, 2, 1, 2, 0, 2]);
const at = (cells: Uint8Array, x: number, y: number) => cells[(y + 1) * (W + 2) + x + 1];

describe("packChartCells", () => {
    it("lays the yarns out inside an empty one-cell border", () => {
        const cells = packChartCells(pixels, W, H, new Int16Array(), null);
        expect(cells).toEqual(new Uint8Array([
            0, 0, 0, 0, 0,
            0, 1, 2, 1, 0,
            0, 2, 0, 2, 0,
            0, 0, 0, 0, 0,
        ]));
    });

    it("marks ✕ on the outward cell in the yarn opposite to the one it lands on", () => {
        const cells = packChartCells(pixels, W, H, new Int16Array([
            PlanType.Valid, PlanDir.Up, 0, 1,     // lands on A at (0, 0)
            PlanType.Valid, PlanDir.Up, 1, 1,     // lands on B at (1, 0)
        ]), null);
        expect(at(cells, 0, 0)).toBe(1 | CELL_CROSS | CELL_CROSS_B);
        expect(at(cells, 1, 0)).toBe(2 | CELL_CROSS);
    });

    it("colours a ✕ in the border against its supporting cell", () => {
        const cells = packChartCells(pixels, W, H, new Int16Array([
            PlanType.Valid, PlanDir.Up, 0, 0,     // supported by A
            PlanType.Valid, PlanDir.Right, 2, 1,  // supported by B
        ]), null);
        expect(at(cells, 0, -1)).toBe(CELL_CROSS | CELL_CROSS_B);
        expect(at(cells, 3, 1)).toBe(CELL_CROSS);
    });

    it("omits a ✕ that lands on a hole", () => {
        const cells = packChartCells(pixels, W, H, new Int16Array([PlanType.Valid, PlanDir.Down, 1, 0]), null);
        expect(at(cells, 1, 1)).toBe(0);
    });

    it("marks ! on the outward cell, including the border and holes", () => {
        const cells = packChartCells(pixels, W, H, new Int16Array([
            PlanType.Invalid, PlanDir.Left, 0, 0,
            PlanType.Invalid, PlanDir.Down, 1, 0,
            PlanType.Invalid, PlanDir.Up, 2, 1,
        ]), null);
        expect(at(cells, -1, 0)).toBe(CELL_WARNING);
        expect(at(cells, 1, 1)).toBe(CELL_WARNING);
        expect(at(cells, 2, 0)).toBe(1 | CELL_WARNING);
    });

    it("keeps only the glyphs whose outward cell the guidance includes", () => {
        const plan = new Int16Array([
            PlanType.Valid, PlanDir.Up, 0, 1,
            PlanType.Invalid, PlanDir.Up, 2, 1,
        ]);
        const cells = packChartCells(pixels, W, H, plan, packInstructionCoordinates([2, 0], W));
        expect(at(cells, 0, 0)).toBe(1);
        expect(at(cells, 2, 0)).toBe(1 | CELL_WARNING);
    });
});
