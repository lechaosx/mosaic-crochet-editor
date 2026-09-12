import { Axis, RepeatGrid } from "./types";
import { axesToFlat } from "./symmetry";
import { MAX_CANVAS_DIMENSION } from "./pattern";

const KIND_REPEAT_X = 5;
const KIND_REPEAT_Y = 6;

export const MAX_REPEAT_POSITIONS = 4_096;

export function defaultRepeatGrid(): RepeatGrid {
    return {
        enabled: false,
        tileWidth: 1,
        tileHeight: 1,
        copiesX: 1,
        copiesY: 1,
    };
}

export function repeatGridError(repeat: RepeatGrid): string | null {
    if (!Number.isSafeInteger(repeat.tileWidth) || !Number.isSafeInteger(repeat.tileHeight)
        || repeat.tileWidth <= 0 || repeat.tileHeight <= 0) {
        return "Repeat tile dimensions must be whole positive numbers.";
    }
    if (repeat.tileWidth > MAX_CANVAS_DIMENSION || repeat.tileHeight > MAX_CANVAS_DIMENSION) {
        return "Repeat tile dimensions cannot exceed 1,048,576 cells.";
    }
    if (!Number.isSafeInteger(repeat.copiesX) || !Number.isSafeInteger(repeat.copiesY)
        || repeat.copiesX < 0 || repeat.copiesY < 0) {
        return "Repeat copies per side must be whole numbers that are zero or positive.";
    }
    const positions = (repeat.copiesX * 2 + 1) * (repeat.copiesY * 2 + 1);
    if (positions > MAX_REPEAT_POSITIONS) {
        return `Repeat grid cannot exceed ${MAX_REPEAT_POSITIONS.toLocaleString("en-US")} positions.`;
    }
    return null;
}

export function assertRepeatGrid(repeat: RepeatGrid): void {
    const error = repeatGridError(repeat);
    if (error) throw new RangeError(error);
}

export function transformsToFlat(
    axes: ReadonlyArray<Axis>, repeat: RepeatGrid,
): Float64Array {
    const axisFlat = axesToFlat(axes);
    if (!repeat.enabled) return axisFlat;
    assertRepeatGrid(repeat);

    const out = new Float64Array(axisFlat.length + 6);
    out.set(axisFlat);
    out.set([
        KIND_REPEAT_X, repeat.tileWidth, repeat.copiesX,
        KIND_REPEAT_Y, repeat.tileHeight, repeat.copiesY,
    ], axisFlat.length);
    return out;
}
