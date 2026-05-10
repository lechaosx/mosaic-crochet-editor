import {
    compute_row_highlights,
    compute_round_highlights,
    initialize_row_pattern,
    initialize_round_pattern,
} from "@mosaic/wasm";
import { PatternState } from "./types";
import { readClampedInt, radioValue } from "./dom";

export let state:      PatternState | null = null;
export let pixels:     Uint8Array   | null = null;
export let highlights: Uint8Array   | null = null;

export function setPixels(p: Uint8Array)      { pixels = p; }
export function setState(s: PatternState)     { state  = s; }

function computeRoundDimensions(innerWidth: number, innerHeight: number, rounds: number, subMode: string) {
    const virtualWidth  = innerWidth  + rounds * 2;
    const virtualHeight = innerHeight + rounds * 2;
    if (subMode === "full") {
        return { canvasWidth: virtualWidth, canvasHeight: virtualHeight, offsetX: 0, offsetY: 0 };
    } else if (subMode === "half") {
        return { canvasWidth: virtualWidth, canvasHeight: innerHeight + rounds, offsetX: 0, offsetY: rounds };
    } else {
        return { canvasWidth: innerWidth + rounds, canvasHeight: innerHeight + rounds, offsetX: 0, offsetY: rounds };
    }
}

export function applySettings() {
    const mode = radioValue("np-mode");
    if (mode === "row") {
        const width  = readClampedInt("width",  2);
        const height = readClampedInt("height", 2);
        state  = { mode, canvasWidth: width, canvasHeight: height };
        pixels = initialize_row_pattern(width, height).slice();
    } else {
        const innerWidth  = readClampedInt("inner-width",  0);
        const innerHeight = readClampedInt("inner-height", 0);
        const rounds      = readClampedInt("rounds",       1);
        const subMode     = radioValue("np-submode");
        const virtualWidth  = innerWidth  + rounds * 2;
        const virtualHeight = innerHeight + rounds * 2;
        const dims = computeRoundDimensions(innerWidth, innerHeight, rounds, subMode);
        state  = { mode: "round", ...dims, virtualWidth, virtualHeight, rounds };
        pixels = initialize_round_pattern(
            dims.canvasWidth, dims.canvasHeight,
            virtualWidth, virtualHeight,
            dims.offsetX, dims.offsetY, rounds
        ).slice();
    }
}


export function recomputeHighlights() {
    if (!state || !pixels) return;
    const { canvasWidth, canvasHeight } = state;
    if (state.mode === "row") {
        highlights = compute_row_highlights(pixels, canvasWidth, canvasHeight).slice();
    } else {
        const { virtualWidth, virtualHeight, offsetX, offsetY, rounds } = state;
        highlights = compute_round_highlights(
            pixels, canvasWidth, canvasHeight,
            virtualWidth, virtualHeight, offsetX, offsetY, rounds
        ).slice();
    }
}
