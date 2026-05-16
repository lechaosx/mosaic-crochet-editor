import {
    initialize_row_pattern, initialize_round_pattern,
    transfer_preserved_row, transfer_preserved_round,
} from "@mosaic/wasm";
import { PatternState } from "./types";
import { devAssert, assertNever } from "./dev";

export type EditSettings =
    | { mode: "row";   width: number; height: number; wipe: boolean }
    | { mode: "round"; innerWidth: number; innerHeight: number; rounds: number; subMode: "full" | "half" | "quarter"; wipe: boolean };

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
        newPixels  = initialize_row_pattern(width, height).slice();
    } else if (settings.mode === "round") {
        const { innerWidth, innerHeight, rounds, subMode } = settings;
        const virtualWidth  = innerWidth  + rounds * 2;
        const virtualHeight = innerHeight + rounds * 2;
        const dims = computeRoundDimensions(innerWidth, innerHeight, rounds, subMode);
        newPattern = { mode: "round", ...dims, virtualWidth, virtualHeight, rounds };
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
