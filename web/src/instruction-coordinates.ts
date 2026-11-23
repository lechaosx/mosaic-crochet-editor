import { PlanCell } from "@mosaic/wasm";
import type { CellRect, HighlightPlan } from "@mosaic/logic/highlight-plan";

// Visits each glyph of a plan for a chart `width` cells wide, or of its
// cells within `rect`: whether it is a warning, the outward cell it lands on,
// and the wrong cell carrying it. A round corner's cell carries two glyphs.
export function forEachPlanGlyph(
    plan: Uint8Array, width: number,
    glyph: (invalid: boolean, x: number, y: number, wrongX: number, wrongY: number) => void,
    rect: CellRect = { x: 0, y: 0, width, height: plan.length / width },
): void {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x, index = y * width + x; x < rect.x + rect.width; x++, index++) {
            const cell = plan[index];
            if (cell === 0) continue;
            const invalid = (cell & PlanCell.Invalid) !== 0;
            if (cell & PlanCell.Up) glyph(invalid, x, y - 1, x, y);
            if (cell & PlanCell.Down) glyph(invalid, x, y + 1, x, y);
            if (cell & PlanCell.Left) glyph(invalid, x - 1, y, x, y);
            if (cell & PlanCell.Right) glyph(invalid, x + 1, y, x, y);
        }
    }
}

// Whether an invalid placement warns at an outward cell missing from every
// list of worked coordinates (x, y pairs).
export function hasUnrepresentedWarning(
    plan: HighlightPlan, width: number, height: number, represented: readonly ArrayLike<number>[],
): boolean {
    if (plan.invalid === 0) return false;
    // Outward cells, the chart gutter included: 1 = warning, 2 = represented warning.
    const stride = width + 2;
    const cells = new Uint8Array(stride * (height + 2));
    let unrepresented = 0;
    forEachPlanGlyph(plan.cells, width, (invalid, x, y) => {
        if (!invalid) return;
        const index = (y + 1) * stride + x + 1;
        unrepresented += cells[index] === 0 ? 1 : 0;
        cells[index] = 1;
    });
    for (const coords of represented) {
        for (let i = 0; i < coords.length; i += 2) {
            const index = (coords[i + 1] + 1) * stride + coords[i] + 1;
            if (cells[index] !== 1) continue;
            cells[index] = 2;
            unrepresented--;
        }
    }
    return unrepresented > 0;
}

export interface PackedInstructionCoordinates {
    readonly values: Uint32Array;
    // The smallest rectangle holding every coordinate; null when there are none.
    readonly bounds: CellRect | null;
    has(x: number, y: number): boolean;
    forEach(callback: (x: number, y: number) => void): void;
}

export function packInstructionCoordinates(
    coords: ArrayLike<number>, canvasWidth: number,
): PackedInstructionCoordinates {
    const stride = canvasWidth + 2;
    const values = new Uint32Array(Math.floor(coords.length / 2));
    for (let index = 0; index < values.length; index++) {
        values[index] = (coords[index * 2 + 1] + 1) * stride + coords[index * 2] + 1;
    }
    values.sort();
    let length = 0;
    for (const value of values) {
        if (length === 0 || values[length - 1] !== value) values[length++] = value;
    }
    const packed = length === values.length ? values : values.slice(0, length);
    const encode = (x: number, y: number) => (y + 1) * stride + x + 1;
    let minX = Infinity, maxX = -Infinity;
    for (let index = 0; index < coords.length; index += 2) {
        minX = Math.min(minX, coords[index]);
        maxX = Math.max(maxX, coords[index]);
    }
    const top = Math.floor(packed[0] / stride) - 1, bottom = Math.floor(packed[packed.length - 1] / stride) - 1;
    return {
        values: packed,
        bounds: packed.length === 0 ? null : { x: minX, y: top, width: maxX - minX + 1, height: bottom - top + 1 },
        has(x, y) {
            if (x < -1 || x > canvasWidth || y < -1) return false;
            const target = encode(x, y);
            let low = 0, high = packed.length - 1;
            while (low <= high) {
                const middle = (low + high) >>> 1;
                if (packed[middle] === target) return true;
                if (packed[middle] < target) low = middle + 1;
                else high = middle - 1;
            }
            return false;
        },
        forEach(callback) {
            for (const value of packed) {
                callback(value % stride - 1, Math.floor(value / stride) - 1);
            }
        },
    };
}
