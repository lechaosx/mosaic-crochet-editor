import { describe, expect, it } from "vitest";
import { PlanCell } from "@mosaic/wasm";
import { forEachPlanGlyph, hasUnrepresentedWarning, packInstructionCoordinates } from "../src/instruction-coordinates";

describe("instruction coordinates", () => {
    it("projects plan glyphs from wrong cells to outward cells", () => {
        const plan = new Uint8Array(3 * 3);
        plan[1 * 3 + 1] = PlanCell.Invalid | PlanCell.Up | PlanCell.Left;   // a corner carries two glyphs
        plan[2 * 3 + 0] = PlanCell.Down;
        plan[0 * 3 + 2] = PlanCell.Invalid | PlanCell.Right;
        const glyphs: unknown[] = [];
        forEachPlanGlyph(plan, 3, (...glyph) => glyphs.push(glyph));
        expect(glyphs).toHaveLength(4);
        expect(glyphs).toEqual(expect.arrayContaining([
            [true, 3, 0, 2, 0],
            [true, 1, 0, 1, 1],
            [true, 0, 1, 1, 1],
            [false, 0, 3, 0, 2],
        ]));
    });
    it("indexes outward coordinates compactly, including the chart gutter", () => {
        const coords = new Int32Array([-1, 0, 0, 0, 1, 0, 1, 0, 32_767, 0]);
        const packed = packInstructionCoordinates(coords, 32_767);

        expect(packed.has(-1, 0)).toBe(true);
        expect(packed.has(0, 0)).toBe(true);
        expect(packed.has(1, 0)).toBe(true);
        expect(packed.has(32_767, 0)).toBe(true);
        expect(packed.has(2, 0)).toBe(false);
        expect(packed.values).toBeInstanceOf(Uint32Array);
        expect(packed.values.byteLength).toBeLessThanOrEqual(coords.byteLength / 2);
    });

    it("keeps a maximum-width row in one packed numeric word per stitch", () => {
        const width = 32_767;
        const coords = new Int32Array(width * 2);
        for (let x = 0; x < width; x++) {
            coords[x * 2] = x;
            coords[x * 2 + 1] = 0;
        }

        const packed = packInstructionCoordinates(coords, width);

        expect(packed.values).toHaveLength(width);
        expect(packed.values.byteLength).toBe(width * Uint32Array.BYTES_PER_ELEMENT);
        expect(packed.has(width - 1, 0)).toBe(true);
        expect(packed.has(width, 0)).toBe(false);
    });

    it("finds a warning whose outward cell no instruction works", () => {
        // A corner cell's two glyphs warn at two outward cells, here both in the gutter.
        const cells = new Uint8Array(3 * 2);
        cells[0] = PlanCell.Invalid | PlanCell.Up | PlanCell.Left;
        cells[1 * 3 + 2] = PlanCell.Invalid | PlanCell.Right;
        const plan = { cells, marked: 2, invalid: 2 };
        expect(hasUnrepresentedWarning({ cells: new Uint8Array(6), marked: 0, invalid: 0 }, 3, 2, [])).toBe(false);
        expect(hasUnrepresentedWarning(plan, 3, 2, [new Int32Array([0, -1, -1, 0]), new Int32Array([3, 1])])).toBe(false);
        expect(hasUnrepresentedWarning(plan, 3, 2, [new Int32Array([0, -1, 3, 1]), new Int32Array([0, -1])])).toBe(true);
    });
});
