// Pattern (Edit) helpers. Pure — no module-scope state. The Edit popover
// reads its inputs and asks for a fresh `{ pattern, pixels }` pair; the
// caller (Store via main.ts) installs them.

import { initialize_row_pattern, initialize_round_pattern } from "@mosaic/wasm";
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
// a fresh canvas. When `source` is passed, still-valid pixels from `source`
// are blitted into the new buffer so live-previewing destructive changes
// (e.g. rounds=1 then back to 20) re-derives from the original each time
// instead of from the most recent preview.
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
    // disabled because the change is inherently destructive (mode switch,
    // inner-dim change). When disabled we don't touch `checked`, so the user's
    // preference survives across always-wipe transitions.
    const wipeEl = document.getElementById("edit-wipe") as HTMLInputElement | null;
    const wipe   = wipeEl ? (wipeEl.checked || wipeEl.disabled) : false;
    if (!wipe && source) {
        overlayPreserved(source.pattern, source.pixels, newPattern, newPixels);
    }
    return { pattern: newPattern, pixels: newPixels };
}

// Copy still-valid pixels from the previous state into the freshly-initialised
// new buffer. Only runs when the mode (row/round) is unchanged; switching mode
// is treated as a fresh start. Anchoring:
//   • row mode   — bottom-anchored vertically (row 1 / foundation stays put),
//                  centre-anchored horizontally.
//   • round mode — centre-anchored in virtual space (the innermost ring keeps
//                  its position; submode toggles and rounds/inner changes line
//                  up around the centre of the pattern).
// Holes in either side are skipped — `newPixels` already has its natural
// colours / holes from `initialize_*_pattern`.
function overlayPreserved(
    oldState: PatternState, oldPixels: Uint8Array,
    newState: PatternState, newPixels: Uint8Array,
) {
    if (oldState.mode !== newState.mode) return;

    const W_old = oldState.canvasWidth, H_old = oldState.canvasHeight;
    const W_new = newState.canvasWidth, H_new = newState.canvasHeight;

    let dx: number, dy: number;
    if (oldState.mode === "row" && newState.mode === "row") {
        dx = Math.floor((W_old - W_new) / 2);
        dy = H_old - H_new;
    } else if (oldState.mode === "round" && newState.mode === "round") {
        const dvx = Math.floor((oldState.virtualWidth  - newState.virtualWidth ) / 2);
        const dvy = Math.floor((oldState.virtualHeight - newState.virtualHeight) / 2);
        dx = newState.offsetX + dvx - oldState.offsetX;
        dy = newState.offsetY + dvy - oldState.offsetY;
    } else {
        return;
    }

    for (let py = 0; py < H_new; py++) {
        const py_old = py + dy;
        if (py_old < 0 || py_old >= H_old) continue;
        for (let px = 0; px < W_new; px++) {
            const px_old = px + dx;
            if (px_old < 0 || px_old >= W_old) continue;
            const v = oldPixels[py_old * W_old + px_old];
            if (v === 0) continue;
            if (newPixels[py * W_new + px] === 0) continue;
            newPixels[py * W_new + px] = v;
        }
    }
}
