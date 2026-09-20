// Per-tool paint dispatch. Each entry takes the visible canvas + click +
// stroke/state context and returns the new canvas. The shared `PaintCtx`
// shape lets `paintAt` look the right op up in `paintOps` instead of
// branching on tool — same surface area as `paint_*` Rust functions.

import {
    paint_pixel, flood_fill,
    paint_natural_row, paint_natural_round,
    paint_overlay_row, paint_overlay_round,
    clear_overlay_row, clear_overlay_round,
    overlay_target_available_row, overlay_target_available_round,
    transformed_target_indices,
} from "@mosaic/wasm";
import { PatternState } from "./types";

export type PaintTool = "pencil" | "fill" | "eraser" | "overlay" | "invert";
export type OverlayAction = "place" | "clear" | "invert";

export interface PaintCtx {
    visible:        Uint8Array;
    pattern:        PatternState;
    x:              number;
    y:              number;
    color:          1 | 2;
    primary:        1 | 2;
    overlayAction?: OverlayAction;
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

    overlay: ({ visible, pattern: p, x, y, overlayAction = "place", invertVisited, transforms }) => {
        const apply = (source: Uint8Array, tx: number, ty: number, action: "place" | "clear", activeTransforms: Float64Array) => {
            if (p.mode === "row") {
                return action === "clear"
                    ? clear_overlay_row(source, p.canvasWidth, p.canvasHeight, tx, ty, activeTransforms)
                    : paint_overlay_row(source, p.canvasWidth, p.canvasHeight, tx, ty, activeTransforms);
            }
            return action === "clear"
                ? clear_overlay_round(source, p.canvasWidth, p.canvasHeight, p.virtualWidth, p.virtualHeight, p.offsetX, p.offsetY, p.rounds, tx, ty, activeTransforms)
                : paint_overlay_round(source, p.canvasWidth, p.canvasHeight, p.virtualWidth, p.virtualHeight, p.offsetX, p.offsetY, p.rounds, tx, ty, activeTransforms);
        };
        if (overlayAction !== "invert") return apply(visible, x, y, overlayAction, transforms);

        const available = (tx: number, ty: number) => p.mode === "row"
            ? overlay_target_available_row(p.canvasWidth, p.canvasHeight, tx, ty)
            : overlay_target_available_round(
                p.canvasWidth, p.canvasHeight,
                p.virtualWidth, p.virtualHeight,
                p.offsetX, p.offsetY, p.rounds,
                tx, ty,
            );
        let out: Uint8Array = visible.slice();
        const none = new Float64Array(0);
        for (const index of transformed_target_indices(p.canvasWidth, p.canvasHeight, x, y, transforms)) {
            if (invertVisited?.has(index)) continue;
            invertVisited?.add(index);
            const tx = index % p.canvasWidth;
            const ty = Math.floor(index / p.canvasWidth);
            const cleared = apply(out, tx, ty, "clear", none);
            const markerWasPresent = cleared.some((pixel, i) => pixel !== out[i]);
            out = markerWasPresent ? cleared : available(tx, ty) ? apply(out, tx, ty, "place", none) : out;
        }
        return out;
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
