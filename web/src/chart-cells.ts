import type { CellRect } from "@mosaic/logic/highlight-plan";
import { PlanCell } from "@mosaic/wasm";
import type { PackedInstructionCoordinates } from "./instruction-coordinates";

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
        const row = (y + 1) * stride + 1;
        cells.fill(0, row + left, row + right + 1);
        if (y >= 0 && y < H) {
            cells.set(pixels.subarray(y * W + Math.max(0, left), y * W + Math.min(W, right + 1)), row + Math.max(0, left));
        }
    }
    // Glyphs landing outside the rewritten cells are already there; setting their flags again keeps them.
    const fromX = Math.max(0, rect.x - 2), toX = Math.min(W, right + 2);
    for (let y = Math.max(0, rect.y - 2); y < Math.min(H, bottom + 2); y++) {
        for (let x = fromX, wrong = y * W + x; x < toX; x++, wrong++) {
            const cell = plan[wrong];
            if (cell === 0) continue;
            if (cell & PlanCell.Up) markGlyph(cells, pixels, W, H, guidance, cell, x, y - 1, wrong);
            if (cell & PlanCell.Down) markGlyph(cells, pixels, W, H, guidance, cell, x, y + 1, wrong);
            if (cell & PlanCell.Left) markGlyph(cells, pixels, W, H, guidance, cell, x - 1, y, wrong);
            if (cell & PlanCell.Right) markGlyph(cells, pixels, W, H, guidance, cell, x + 1, y, wrong);
        }
    }
    return [(top + 1) * stride, (bottom + 2) * stride];
}

// The region of a W × H chart to rewrite when the guidance changes from
// `before` to `after` along with the pixels and plan of `change`: glyphs
// appear or disappear only on cells either guidance holds, or anywhere when
// either shows every glyph. Guided border cells are rewritten with the chart
// cells next to them.
export function guidanceChange(
    change: CellRect | "all" | null,
    before: PackedInstructionCoordinates | null, after: PackedInstructionCoordinates | null,
    W: number, H: number,
): CellRect | "all" | null {
    if (!before || !after || change === "all") return "all";
    const union = [change, before.bounds, after.bounds].reduce<CellRect | null>((union, rect) => {
        if (!union || !rect) return union ?? rect;
        const x = Math.min(union.x, rect.x), y = Math.min(union.y, rect.y);
        return { x, y,
            width: Math.max(union.x + union.width, rect.x + rect.width) - x,
            height: Math.max(union.y + union.height, rect.y + rect.height) - y };
    }, null);
    if (!union) return null;
    const clamp = (value: number, size: number) => Math.min(Math.max(value, 0), size - 1);
    const x = clamp(union.x, W), y = clamp(union.y, H);
    return { x, y,
        width: clamp(union.x + union.width - 1, W) - x + 1, height: clamp(union.y + union.height - 1, H) - y + 1 };
}

// The flags a glyph sets on its outward cell, indexed by its warning bit and the
// yarn under the ✕, which contrasts with that yarn and is omitted on a hole.
// Looked up rather than branched on: a noisy chart defeats branch prediction.
const GLYPH_FLAGS = new Uint8Array([
    0, CELL_CROSS | CELL_CROSS_B, CELL_CROSS, 0,
    CELL_WARNING, CELL_WARNING, CELL_WARNING, 0,
]);

// Flags the glyph of plan byte `cell`, whose wrong cell is at index `wrong`, on its outward cell (x, y).
function markGlyph(
    cells: Uint8Array, pixels: Uint8Array, W: number, H: number,
    guidance: PackedInstructionCoordinates | null, cell: number, x: number, y: number, wrong: number,
): void {
    if (guidance && !guidance.has(x, y)) return;
    // ✕ contrasts with the yarn it lands on; in the border, with its supporting cell.
    const under = pixels[x >= 0 && x < W && y >= 0 && y < H ? y * W + x : wrong];
    cells[(y + 1) * (W + 2) + x + 1] |= GLYPH_FLAGS[(cell & PlanCell.Invalid) << 2 | under];
}
