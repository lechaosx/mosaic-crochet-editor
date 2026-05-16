export type Tool   = "pencil" | "fill" | "eraser" | "invert" | "overlay" | "select" | "wand" | "move";
export type SymKey = "V" | "H" | "C" | "D1" | "D2";

// A "float" is the lifted-selection layer that sits above the canvas. The
// pixels at `mask` cells were physically removed from `pixels` (replaced
// with natural baseline) when the float was created; rendering pastes them
// back on top at offset `(dx, dy)`. Commit (deselect / tool switch / etc.)
// stamps them at the offset position and clears the float. The mask and
// pixels are stored in **source coordinates** — i.e., wherever the cells
// were when first lifted; the offset accumulates moves.
export interface Float {
    mask:   Uint8Array;   // W*H, 1 where the float covers (source positions)
    pixels: Uint8Array;   // W*H, lifted pixel values at mask cells (else 0)
    dx:     number;
    dy:     number;
}

// Tiny constructor namespace — we build floats from scratch in many places.
// Keeping the field shape consistent matters for the renderer / store /
// snapshot/serialiser, so the helpers are the single source of truth for
// "what shape does a Float have".
export const Float = {
    // Float with the same mask / pixels / offset as `f` but a new offset.
    shifted: (f: Float, dx: number, dy: number): Float =>
        ({ mask: f.mask, pixels: f.pixels, dx, dy }),
    // Float with `f`'s mask + offset but fresh pixels (used by mask-only
    // drag to zero out content without losing the marquee).
    withPixels: (f: Float, pixels: Uint8Array): Float =>
        ({ mask: f.mask, pixels, dx: f.dx, dy: f.dy }),
} as const;

export interface RowState {
    mode:         "row";
    canvasWidth:  number;
    canvasHeight: number;
}

export interface RoundState {
    mode:          "round";
    canvasWidth:   number;
    canvasHeight:  number;
    virtualWidth:  number;
    virtualHeight: number;
    offsetX:       number;
    offsetY:       number;
    rounds:        number;
}

export type PatternState = RowState | RoundState;
