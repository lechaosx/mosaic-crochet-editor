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

// Unified Pattern (Edit) flow: reads mode + dims from the popover and rebuilds
// the canvas. `source` is the pre-edit pattern to overlay-preserve from — the
// caller passes the history head, so live-previewing destructive changes
// (e.g. rounds=1 then back to 20) re-derives from the original each time
// instead of from the most recent preview. When `source` is omitted (initial
// boot), there's nothing to preserve.
export function applyEditSettings(source?: { state: PatternState; pixels: Uint8Array }) {
    const oldState  = source?.state  ?? state;
    const oldPixels = source?.pixels ?? pixels;

    const mode = radioValue("edit-mode");
    let newState:  PatternState;
    let newPixels: Uint8Array;
    if (mode === "row") {
        const width  = readClampedInt("edit-width",  2);
        const height = readClampedInt("edit-height", 2);
        newState  = { mode, canvasWidth: width, canvasHeight: height };
        newPixels = initialize_row_pattern(width, height).slice();
    } else {
        const innerWidth  = readClampedInt("edit-inner-width",  0);
        const innerHeight = readClampedInt("edit-inner-height", 0);
        const rounds      = readClampedInt("edit-rounds",       1);
        const subMode     = radioValue("edit-submode");
        const virtualWidth  = innerWidth  + rounds * 2;
        const virtualHeight = innerHeight + rounds * 2;
        const dims = computeRoundDimensions(innerWidth, innerHeight, rounds, subMode);
        newState  = { mode: "round", ...dims, virtualWidth, virtualHeight, rounds };
        newPixels = initialize_round_pattern(
            dims.canvasWidth, dims.canvasHeight,
            virtualWidth, virtualHeight,
            dims.offsetX, dims.offsetY, rounds,
        ).slice();
    }

    // Effective wipe = user explicitly checked the toggle, OR the toggle is
    // disabled because the change is inherently destructive (mode switch,
    // inner-dim change). When disabled we don't touch `checked`, so the user's
    // preference survives across always-wipe transitions — flipping an input
    // back restores the painted preview without re-toggling.
    const wipeEl = document.getElementById("edit-wipe") as HTMLInputElement | null;
    const wipe   = wipeEl ? (wipeEl.checked || wipeEl.disabled) : false;
    if (!wipe && oldState && oldPixels) {
        overlayPreserved(oldState, oldPixels, newState, newPixels);
    }

    state  = newState;
    pixels = newPixels;
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
        // Map via virtual coordinates so submode/inner/rounds changes all line
        // up around the pattern centre.
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
            // Don't overwrite a hole in the new buffer (the new pattern's
            // geometry decides hole positions).
            if (newPixels[py * W_new + px] === 0) continue;
            newPixels[py * W_new + px] = v;
        }
    }
}


// A cell is *always* invalid if there's no way for it to host a valid overlay
// — it has nowhere outward for the X to land. Mirrors the Rust highlight rules:
//   • row mode — top row only (y == 0). The bottom row (foundation) has no
//     inner row to clash with, so any colour there is a *valid* overlay onto
//     the row above.
//   • round mode — outermost ring (rfe == 0) or any diagonal pixel (dx == dy).
// Hole positions don't count.
export function isAlwaysInvalid(s: PatternState, x: number, y: number): boolean {
    if (s.mode === "row") return y === 0;
    const vx = x + s.offsetX, vy = y + s.offsetY;
    const dx = Math.min(vx, s.virtualWidth  - 1 - vx);
    const dy = Math.min(vy, s.virtualHeight - 1 - vy);
    const rfe = Math.min(dx, dy);
    if (rfe >= s.rounds) return false;
    return rfe === 0 || dx === dy;
}

// The cells one step *outward* from (x, y) — i.e. where the highlight marker
// for a wrong cell at (x, y) gets drawn. Returns 1 outward for non-corner
// cells; for round-mode corners (dx == dy) it returns 2 — one along each
// perpendicular axis — because a corner's overlay attaches to two adjacent
// outer cells. For boundary cells the returned coords land outside the
// canvas; the render's matrix transform places the glyph in the gutter.
export function outwardCells(s: PatternState, x: number, y: number): { x: number; y: number }[] {
    if (s.mode === "row") return [{ x, y: y - 1 }];
    const vx = x + s.offsetX, vy = y + s.offsetY;
    const dx = Math.min(vx, s.virtualWidth  - 1 - vx);
    const dy = Math.min(vy, s.virtualHeight - 1 - vy);
    const sx = vx * 2 >= s.virtualWidth  ? -1 : 1;
    const sy = vy * 2 >= s.virtualHeight ? -1 : 1;
    if (dx === dy) return [{ x: x - sx, y }, { x, y: y - sy }];
    if (dx < dy)   return [{ x: x - sx, y }];
    return [{ x, y: y - sy }];
}

// The "should-be" colour for each cell — same array `initialize_*_pattern`
// would return. Used by the Lock-invalid post-filter to know what's "correct".
export function naturalPatternFor(s: PatternState): Uint8Array {
    return s.mode === "row"
        ? initialize_row_pattern(s.canvasWidth, s.canvasHeight)
        : initialize_round_pattern(
              s.canvasWidth, s.canvasHeight, s.virtualWidth, s.virtualHeight,
              s.offsetX, s.offsetY, s.rounds,
          );
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
