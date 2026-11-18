import { describe, expect, it } from "vitest";
import { cellTextureLayout } from "../src/chart-layer";

describe("cellTextureLayout", () => {
    it("wraps four cell bytes per texel into rows as wide as the texture limit allows", () => {
        expect(cellTextureLayout(11 * 11, 4096)).toEqual({ rowShift: 12, rows: 1 });
        // The largest square pattern, 4096 × 4096 cells plus its border.
        expect(cellTextureLayout(4098 * 4098, 4096)).toEqual({ rowShift: 12, rows: 1026 });
        expect(cellTextureLayout(4098 * 4098, 16384)).toEqual({ rowShift: 14, rows: 257 });
    });

    it("has no layout when the rows exceed the texture limit", () => {
        expect(cellTextureLayout(2048 * 2048 * 4, 2048)).toEqual({ rowShift: 11, rows: 2048 });
        expect(cellTextureLayout(2048 * 2048 * 4 + 1, 2048)).toBeNull();
        expect(cellTextureLayout(4098 * 4098, 2048)).toBeNull();
    });
});
