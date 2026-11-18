import { PlanType } from "@mosaic/wasm";
import { planOutwardCoordinate, type PackedInstructionCoordinates } from "./instruction-coordinates";

// The chart layer's cell bytes: bits 0–1 hold the yarn (0 = hole or outside),
// the flags below the plan glyph drawn on that cell.
export const CELL_CROSS = 4;
export const CELL_CROSS_B = 8;    // ✕ in yarn B rather than A
export const CELL_WARNING = 16;

// One byte per cell, row-major over (W + 2) × (H + 2) starting at (-1, -1):
// a glyph's outward cell can lie one cell outside the pattern.
export function packChartCells(
    pixels: Uint8Array, W: number, H: number, plan: Int16Array, guidance: PackedInstructionCoordinates | null,
): Uint8Array {
    const stride = W + 2;
    const cells = new Uint8Array(stride * (H + 2));
    for (let y = 0; y < H; y++) cells.set(pixels.subarray(y * W, (y + 1) * W), (y + 1) * stride + 1);
    for (let i = 0; i < plan.length; i += 4) {
        const [x, y] = planOutwardCoordinate(plan, i);
        if (guidance && !guidance.has(x, y)) continue;
        const index = (y + 1) * stride + x + 1;
        if (plan[i] === PlanType.Invalid) {
            cells[index] |= CELL_WARNING;
            continue;
        }
        // ✕ contrasts with the yarn it lands on; in the border, with its supporting cell.
        const under = x >= 0 && x < W && y >= 0 && y < H ? pixels[y * W + x] : pixels[plan[i + 3] * W + plan[i + 2]];
        if (under !== 0) cells[index] |= CELL_CROSS | (under === 1 ? CELL_CROSS_B : 0);
    }
    return cells;
}
