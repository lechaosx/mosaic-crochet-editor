import type { CellRect } from "@mosaic/logic/highlight-plan";
import { forEachPlanGlyph, type PackedInstructionCoordinates } from "./instruction-coordinates";

// The chart layer's cell bytes: bits 0–1 hold the yarn (0 = hole or outside),
// the flags below the plan glyph drawn on that cell.
export const CELL_CROSS = 4;
export const CELL_CROSS_B = 8;    // ✕ in yarn B rather than A
export const CELL_WARNING = 16;

// One byte per cell, row-major over (W + 2) × (H + 2) starting at (-1, -1):
// a glyph's outward cell can lie one cell outside the pattern.
export function packChartCells(
    pixels: Uint8Array, W: number, H: number, plan: Uint8Array, guidance: PackedInstructionCoordinates | null,
): Uint8Array {
    const cells = new Uint8Array((W + 2) * (H + 2));
    repackChartCells(cells, pixels, W, H, plan, guidance, { x: 0, y: 0, width: W, height: H });
    return cells;
}

// Rewrites the cells within one cell of `rect`, outside which the pixels and
// plan are unchanged: a glyph lands one cell outward from its wrong cell, so
// those cells take glyphs from the plan within two cells of `rect`. Returns
// the byte range of the rows rewritten.
export function repackChartCells(
    cells: Uint8Array, pixels: Uint8Array, W: number, H: number, plan: Uint8Array,
    guidance: PackedInstructionCoordinates | null, rect: CellRect,
): [start: number, end: number] {
    const stride = W + 2;
    const top = rect.y - 1, bottom = rect.y + rect.height;
    const left = rect.x - 1, right = rect.x + rect.width;
    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
            cells[(y + 1) * stride + x + 1] = x >= 0 && x < W && y >= 0 && y < H ? pixels[y * W + x] : 0;
        }
    }
    // Glyphs landing outside the rewritten cells are already there; setting their flags again keeps them.
    const sources = { x: Math.max(0, rect.x - 2), y: Math.max(0, rect.y - 2) };
    forEachPlanGlyph(plan, W, (invalid, x, y, wrongX, wrongY) => {
        if (guidance && !guidance.has(x, y)) return;
        const index = (y + 1) * stride + x + 1;
        if (invalid) {
            cells[index] |= CELL_WARNING;
            return;
        }
        // ✕ contrasts with the yarn it lands on; in the border, with its supporting cell.
        const under = x >= 0 && x < W && y >= 0 && y < H ? pixels[y * W + x] : pixels[wrongY * W + wrongX];
        if (under !== 0) cells[index] |= CELL_CROSS | (under === 1 ? CELL_CROSS_B : 0);
    }, { ...sources, width: Math.min(W, right + 2) - sources.x, height: Math.min(H, bottom + 2) - sources.y });
    return [(top + 1) * stride, (bottom + 2) * stride];
}
