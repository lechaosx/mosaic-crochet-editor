import {
    initialize_row_pattern, initialize_round_pattern,
    transfer_preserved_row, transfer_preserved_round,
} from "@mosaic/wasm";
import { PatternState } from "./types";
import { devAssert, assertNever } from "./dev";

export type EditSettings =
    | { mode: "row";   width: number; height: number; wipe: boolean }
    | { mode: "round"; innerWidth: number; innerHeight: number; rounds: number; subMode: "full" | "half" | "quarter"; wipe: boolean };

export const MAX_CANVAS_DIMENSION = 1_048_576;
export const MAX_CANVAS_CELLS = 16_777_216;

export function patternDimensionError(pattern: PatternState): string | null {
    const p = pattern as unknown as Record<string, unknown>;
    const width = p.canvasWidth;
    const height = p.canvasHeight;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || (width as number) <= 0 || (height as number) <= 0) {
        return "Canvas dimensions must be whole positive numbers.";
    }
    if ((width as number) > MAX_CANVAS_DIMENSION || (height as number) > MAX_CANVAS_DIMENSION) {
        return "Canvas dimensions cannot exceed 1,048,576 cells on either axis.";
    }
    if ((width as number) * (height as number) > MAX_CANVAS_CELLS) {
        return "Canvas cannot exceed 16,777,216 cells.";
    }
    if (p.mode === "row") return null;
    if (p.mode !== "round") return "Pattern mode is invalid.";

    const virtualWidth = p.virtualWidth;
    const virtualHeight = p.virtualHeight;
    const offsetX = p.offsetX;
    const offsetY = p.offsetY;
    const rounds = p.rounds;
    if (![virtualWidth, virtualHeight, offsetX, offsetY, rounds].every(Number.isSafeInteger)
        || (virtualWidth as number) <= 0 || (virtualHeight as number) <= 0
        || (offsetX as number) < 0 || (offsetY as number) < 0 || (rounds as number) <= 0) {
        return "Round-pattern dimensions must be whole positive numbers.";
    }
    if ((virtualWidth as number) > MAX_CANVAS_DIMENSION * 2
        || (virtualHeight as number) > MAX_CANVAS_DIMENSION * 2
        || (rounds as number) * 2 > (virtualWidth as number)
        || (rounds as number) * 2 > (virtualHeight as number)
        || (offsetX as number) + (width as number) > (virtualWidth as number)
        || (offsetY as number) + (height as number) > (virtualHeight as number)) {
        return "Round-pattern geometry is invalid.";
    }
    return null;
}

export function assertPatternDimensions(pattern: PatternState): void {
    const error = patternDimensionError(pattern);
    if (error) throw new RangeError(error);
}

function computeRoundDimensions(innerWidth: number, innerHeight: number, rounds: number, subMode: string) {
    const virtualWidth  = innerWidth  + rounds * 2;
    const virtualHeight = innerHeight + rounds * 2;
    if (subMode === "full") {
        return { canvasWidth: virtualWidth, canvasHeight: virtualHeight, offsetX: 0, offsetY: 0 };
    } else if (subMode === "half") {
        return { canvasWidth: virtualWidth, canvasHeight: innerHeight + rounds, offsetX: 0, offsetY: rounds };
    } else {
        devAssert(subMode === "quarter", "unknown subMode");
        return { canvasWidth: innerWidth + rounds, canvasHeight: innerHeight + rounds, offsetX: 0, offsetY: rounds };
    }
}

export function applyEditSettings(
    settings: EditSettings,
    source?: { pattern: PatternState; pixels: Uint8Array },
): { pattern: PatternState; pixels: Uint8Array } {
    let newPattern: PatternState;
    let newPixels:  Uint8Array;
    if (settings.mode === "row") {
        const { width, height } = settings;
        newPattern = { mode: "row", canvasWidth: width, canvasHeight: height };
        assertPatternDimensions(newPattern);
        newPixels  = initialize_row_pattern(width, height).slice();
    } else if (settings.mode === "round") {
        const { innerWidth, innerHeight, rounds, subMode } = settings;
        const virtualWidth  = innerWidth  + rounds * 2;
        const virtualHeight = innerHeight + rounds * 2;
        const dims = computeRoundDimensions(innerWidth, innerHeight, rounds, subMode);
        newPattern = { mode: "round", ...dims, virtualWidth, virtualHeight, rounds };
        assertPatternDimensions(newPattern);
        newPixels  = initialize_round_pattern(
            dims.canvasWidth, dims.canvasHeight,
            virtualWidth, virtualHeight,
            dims.offsetX, dims.offsetY, rounds,
        ).slice();
    } else {
        return assertNever(settings, "applyEditSettings: unknown mode");
    }

    if (!settings.wipe && source) {
        const old = source.pattern;
        if (old.mode === "row" && newPattern.mode === "row") {
            newPixels = transfer_preserved_row(
                source.pixels, old.canvasWidth, old.canvasHeight,
                newPixels,     newPattern.canvasWidth, newPattern.canvasHeight,
            );
        } else if (old.mode === "round" && newPattern.mode === "round") {
            newPixels = transfer_preserved_round(
                source.pixels,
                old.canvasWidth,  old.canvasHeight,
                old.virtualWidth, old.virtualHeight,
                old.offsetX,      old.offsetY,      old.rounds,
                newPixels,
                newPattern.canvasWidth,  newPattern.canvasHeight,
                newPattern.virtualWidth, newPattern.virtualHeight,
                newPattern.offsetX,      newPattern.offsetY,      newPattern.rounds,
            );
        }
    }
    return { pattern: newPattern, pixels: newPixels };
}
