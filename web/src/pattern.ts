// Pattern (Edit) helpers. Pure — no module-scope state. The Edit popover
// reads its inputs and asks for a fresh `{ pattern, pixels }` pair; the
// caller (Store via main.ts) installs them.

import {
    initialize_row_pattern, initialize_round_pattern,
    transfer_preserved_row, transfer_preserved_round,
} from "@mosaic/wasm";
import { PatternState } from "./types";
import { readClampedInt, radioValue } from "./dom";

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

// Unified Pattern (Edit) flow: reads mode + dims from the popover and builds
// a fresh canvas. When `source` is passed, painted pixels from `source` are
// preserved into the new buffer where they map — the WASM `transfer_preserved_*`
// functions implement the per-mode anchoring rules. Caller (main.ts) passes
// the history head as source, so live-previewing destructive changes
// (e.g. rounds=1 then back to 20) re-derives from the original each time.
export function applyEditSettings(
    source?: { pattern: PatternState; pixels: Uint8Array },
): { pattern: PatternState; pixels: Uint8Array } {
    const mode = radioValue("edit-mode");
    let newPattern: PatternState;
    let newPixels:  Uint8Array;
    if (mode === "row") {
        const width  = readClampedInt("edit-width",  2);
        const height = readClampedInt("edit-height", 2);
        newPattern = { mode, canvasWidth: width, canvasHeight: height };
        newPixels  = initialize_row_pattern(width, height).slice();
    } else {
        const innerWidth  = readClampedInt("edit-inner-width",  0);
        const innerHeight = readClampedInt("edit-inner-height", 0);
        const rounds      = readClampedInt("edit-rounds",       1);
        const subMode     = radioValue("edit-submode");
        const virtualWidth  = innerWidth  + rounds * 2;
        const virtualHeight = innerHeight + rounds * 2;
        const dims = computeRoundDimensions(innerWidth, innerHeight, rounds, subMode);
        newPattern = { mode: "round", ...dims, virtualWidth, virtualHeight, rounds };
        newPixels  = initialize_round_pattern(
            dims.canvasWidth, dims.canvasHeight,
            virtualWidth, virtualHeight,
            dims.offsetX, dims.offsetY, rounds,
        ).slice();
    }

    // Effective wipe = user explicitly checked the toggle, OR the toggle is
    // disabled because the change is inherently destructive (mode switch).
    // When disabled we don't touch `checked`, so the user's preference
    // survives across always-wipe transitions.
    const wipeEl = document.getElementById("edit-wipe") as HTMLInputElement | null;
    const wipe   = wipeEl ? (wipeEl.checked || wipeEl.disabled) : false;
    if (!wipe && source) {
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
