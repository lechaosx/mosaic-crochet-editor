// Per-tool paint dispatch. Each entry takes the visible canvas + click +
// stroke/state context and returns the new canvas. The shared `PaintCtx`
// shape lets `paintAt` look the right op up in `paintOps` instead of
// branching on tool — same surface area as `paint_*` Rust functions.

import {
    paint_pixel, flood_fill,
    paint_natural_row, paint_natural_round,
    paint_overlay_row, paint_overlay_round,
    clear_overlay_row, clear_overlay_round,
    transformed_target_indices,
} from "@mosaic/wasm";
import { PatternState } from "./types";

export type PaintTool = "pencil" | "fill" | "eraser" | "overlay" | "invert";

export interface PaintCtx {
    visible:        Uint8Array;
    pattern:        PatternState;
    x:              number;
    y:              number;
    color:          1 | 2;
    primary:        1 | 2;
    invertVisited:  Set<number> | null;
    transforms:     Float64Array;
    shifted:        Uint8Array | null;
}

type PaintOp = (c: PaintCtx) => Uint8Array;

export const paintOps: Record<PaintTool, PaintOp> = {
    pencil: ({ visible, pattern: p, x, y, color, transforms, shifted }) =>
        paint_pixel(visible, p.canvasWidth, p.canvasHeight, x, y, color, transforms, shifted),

    fill: ({ visible, pattern: p, x, y, color, transforms, shifted }) =>
        flood_fill(visible, p.canvasWidth, p.canvasHeight, x, y, color, transforms, shifted),

    // Left click = primary = restore baseline; right click = secondary =
    // paint the *opposite* baseline (deliberately wrong placement).
    eraser: ({ visible, pattern: p, x, y, color, primary, transforms, shifted }) => {
        const invert = color !== primary;
        return p.mode === "row"
            ? paint_natural_row(visible, p.canvasWidth, p.canvasHeight, x, y, transforms, invert, shifted)
            : paint_natural_round(
                visible, p.canvasWidth, p.canvasHeight,
                p.virtualWidth, p.virtualHeight,
                p.offsetX, p.offsetY, p.rounds,
                x, y, transforms, invert, shifted,
            );
    },

    // Left click = paint a ✕ at the click cell (writes its *inward
    // neighbour*); right click = clear it.
    overlay: ({ visible, pattern: p, x, y, color, primary, transforms }) => {
        const clear = color !== primary;
        if (p.mode === "row") {
            return clear
                ? clear_overlay_row(visible, p.canvasWidth, p.canvasHeight, x, y, transforms)
                : paint_overlay_row(visible, p.canvasWidth, p.canvasHeight, x, y, transforms);
        }
        return clear
            ? clear_overlay_round(visible, p.canvasWidth, p.canvasHeight, p.virtualWidth, p.virtualHeight, p.offsetX, p.offsetY, p.rounds, x, y, transforms)
            : paint_overlay_round(visible, p.canvasWidth, p.canvasHeight, p.virtualWidth, p.virtualHeight, p.offsetX, p.offsetY, p.rounds, x, y, transforms);
    },

    // Flip pixels between primary and secondary on each *first* visit; a
    // single stroke never inverts the same cell twice.
    invert: ({ visible, pattern: p, x, y, invertVisited, transforms, shifted }) => {
        const out = visible.slice();
        const indices = transformed_target_indices(p.canvasWidth, p.canvasHeight, x, y, transforms);
        for (const idx of indices) {
            if (invertVisited!.has(idx)) continue;
            if (shifted && shifted[idx] === 0) continue;
            invertVisited!.add(idx);
            const cur = out[idx];
            if      (cur === 1) out[idx] = 2;
            else if (cur === 2) out[idx] = 1;
        }
        return out;
    },
};
