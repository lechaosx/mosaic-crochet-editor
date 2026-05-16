// Selection / float operations. Pure helpers (`liftCells`, `cutCells`,
// `rectMask`, `shiftedFloatMask`, `anchorIntoCanvas`) compute new state;
// store-mutating ops (`applySelectionMod`, `commitSelectRect`,
// `commitWandAt`, `selectAll`, `deselect`, `anchorFloat`) wrap the pure
// helpers with a `store.commit`.

import { wand_select,
         cut_to_natural_row, cut_to_natural_round } from "@mosaic/wasm";
import { PatternState, Float } from "./types";
import { Store, SessionState, visiblePixels } from "./store";
import { devAssert, assertNever } from "./dev";

export type SelectMode = "replace" | "add" | "remove";

// ── Pure helpers ─────────────────────────────────────────────────────────────

// Cut cells from `pixels` to natural baseline, returning the new buffer.
export function cutCells(pixels: Uint8Array, pattern: PatternState, mask: Uint8Array): Uint8Array {
    const { canvasWidth: W, canvasHeight: H } = pattern;
    return pattern.mode === "row"
        ? cut_to_natural_row(pixels, W, H, mask)
        : cut_to_natural_round(
            pixels, W, H,
            pattern.virtualWidth, pattern.virtualHeight,
            pattern.offsetX, pattern.offsetY, pattern.rounds,
            mask,
        );
}

// Lift the cells indicated by `liftMask` from `pixels` into a fresh float
// at dx=dy=0. Canvas at lifted cells is cut to natural baseline. `liftMask`
// should already exclude holes; returns `float: null` if no cells qualify.
export function liftCells(
    pixels: Uint8Array, pattern: PatternState, liftMask: Uint8Array,
): { pixels: Uint8Array; float: Float | null } {
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    const n = W * H;
    const mask   = new Uint8Array(n);
    const lifted = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
        if (!liftMask[i]) continue;
        mask[i]   = 1;
        lifted[i] = pixels[i];
        any = true;
    }
    if (!any) return { pixels, float: null };
    const newPixels = cutCells(pixels, pattern, mask);
    return { pixels: newPixels, float: { mask, pixels: lifted, dx: 0, dy: 0 } };
}

// Build a mask covering `(x1,y1)..(x2,y2)` (inclusive, canvas-clipped),
// skipping hole cells.
export function rectMask(
    pixels: Uint8Array, W: number, H: number,
    x1: number, y1: number, x2: number, y2: number,
): Uint8Array {
    const m = new Uint8Array(W * H);
    const ux1 = Math.min(x1, x2), uy1 = Math.min(y1, y2);
    const ux2 = Math.max(x1, x2), uy2 = Math.max(y1, y2);
    if (ux2 < 0 || ux1 >= W || uy2 < 0 || uy1 >= H) return m;
    const cx1 = Math.max(0, ux1), cy1 = Math.max(0, uy1);
    const cx2 = Math.min(W - 1, ux2), cy2 = Math.min(H - 1, uy2);
    for (let y = cy1; y <= cy2; y++) {
        for (let x = cx1; x <= cx2; x++) {
            if (pixels[y * W + x] === 0) continue;
            m[y * W + x] = 1;
        }
    }
    return m;
}

// The float's shifted mask in canvas coordinates — used as a "selection
// mask" for paint clipping and hit-testing.
export function shiftedFloatMask(s: SessionState): Uint8Array {
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    const out = new Uint8Array(W * H);
    if (!s.float) return out;
    const { mask, dx: fdx, dy: fdy } = s.float;
    for (let sy = 0; sy < H; sy++) {
        const srow = sy * W;
        for (let sx = 0; sx < W; sx++) {
            if (mask[srow + sx] === 0) continue;
            const dx = sx + fdx, dy = sy + fdy;
            if (dx < 0 || dx >= W || dy < 0 || dy >= H) continue;
            out[dy * W + dx] = 1;
        }
    }
    return out;
}

// Bake the float into the canvas: stamp at current offset, drop the float.
// No-op when there's no float (`visiblePixels` returns pixels unchanged).
export function anchorIntoCanvas(s: SessionState): { pixels: Uint8Array; float: null } {
    return { pixels: visiblePixels(s), float: null };
}

// ── Store-mutating selection ops ─────────────────────────────────────────────

// Unified selection-modify dispatched by both rect-select and wand. Three
// paths, each chosen to keep the float's existing lift state intact:
//   replace → anchor any active float, lift the region fresh
//   add     → lift just the new region cells into the float at
//             (canvas − offset) source positions; existing float untouched.
//             Cells whose source position falls off the W×H mask grid are
//             skipped — rare in practice, not worth a re-anchor.
//   remove  → stamp each region cell that's currently in the float back
//             onto the canvas at its visible position; mask shrinks.
export function applySelectionMod(store: Store, region: Uint8Array, mode: SelectMode): void {
    const s = store.state;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    const n = W * H;

    if (mode === "replace") {
        const anchored = s.float ? visiblePixels(s) : s.pixels;
        const clean = region.slice();
        for (let i = 0; i < n; i++) if (anchored[i] === 0) clean[i] = 0;
        const lifted = liftCells(anchored, s.pattern, clean);
        store.commit(state => { state.pixels = lifted.pixels; state.float = lifted.float; }, { history: true });
        return;
    }

    if (!s.float) {
        // No existing float: `add` lifts the region; `remove` is a no-op.
        if (mode === "add") {
            const clean = region.slice();
            for (let i = 0; i < n; i++) if (s.pixels[i] === 0) clean[i] = 0;
            const lifted = liftCells(s.pixels, s.pattern, clean);
            store.commit(state => { state.pixels = lifted.pixels; state.float = lifted.float; }, { history: true });
        }
        return;
    }

    const f = s.float;
    if (mode === "add") {
        const newMask   = f.mask.slice();
        const newLifted = f.pixels.slice();
        const cutMask   = new Uint8Array(n);
        let any = false;
        for (let cy = 0; cy < H; cy++) {
            for (let cx = 0; cx < W; cx++) {
                if (region[cy * W + cx] === 0) continue;
                if (s.pixels[cy * W + cx] === 0) continue;   // hole
                const sx = cx - f.dx, sy = cy - f.dy;
                if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
                if (newMask[sy * W + sx] === 1) continue;    // already in float
                newMask[sy * W + sx]   = 1;
                newLifted[sy * W + sx] = s.pixels[cy * W + cx];
                cutMask[cy * W + cx]   = 1;
                any = true;
            }
        }
        if (!any) return;
        const cutPixels = cutCells(s.pixels, s.pattern, cutMask);
        store.commit(state => {
            state.pixels = cutPixels;
            state.float  = { mask: newMask, pixels: newLifted, dx: f.dx, dy: f.dy };
        }, { history: true });
        return;
    }

    if (mode !== "remove") assertNever(mode, "applySelectionMod");
    const newPixels = s.pixels.slice();
    const newMask   = f.mask.slice();
    const newLifted = f.pixels.slice();
    let removed = false;
    for (let cy = 0; cy < H; cy++) {
        for (let cx = 0; cx < W; cx++) {
            if (region[cy * W + cx] === 0) continue;
            const sx = cx - f.dx, sy = cy - f.dy;
            if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
            if (newMask[sy * W + sx] === 0) continue;
            if (newPixels[cy * W + cx] === 0) continue;     // hole — leave alone
            newPixels[cy * W + cx] = newLifted[sy * W + sx];
            newMask[sy * W + sx]   = 0;
            newLifted[sy * W + sx] = 0;
            removed = true;
        }
    }
    if (!removed) return;
    let any = false;
    for (let i = 0; i < n; i++) if (newMask[i]) { any = true; break; }
    store.commit(state => {
        state.pixels = newPixels;
        state.float  = any ? { mask: newMask, pixels: newLifted, dx: f.dx, dy: f.dy } : null;
    }, { history: true });
}

// Apply a select-tool rect drag with the given mode. Region is gated
// against the visible canvas so hole-exclusion follows the user's view.
export function commitSelectRect(
    store: Store, x1: number, y1: number, x2: number, y2: number, mode: SelectMode,
): void {
    const s = store.state;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    const visible = visiblePixels(s);
    const region  = rectMask(visible, W, H, x1, y1, x2, y2);
    applySelectionMod(store, region, mode);
}

// Apply a wand-tool action at (x, y). Picks the connected same-colour
// region in replace mode (we apply add/remove locally — the Rust
// `wand_select`'s "remove" expects an existing mask to subtract from).
export function commitWandAt(store: Store, x: number, y: number, mode: SelectMode): void {
    const s = store.state;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    devAssert(x >= 0 && x < W && y >= 0 && y < H, "commitWandAt out of bounds");
    const visible = visiblePixels(s);
    if (visible[y * W + x] === 0) return;   // hole click — no-op
    const region = wand_select(visible, W, H, x, y, 0, new Uint8Array(0));
    applySelectionMod(store, region, mode);
}

// Lift every non-hole cell into a fresh float (anchoring any existing one).
export function selectAll(store: Store): void {
    const s = store.state;
    const visible = visiblePixels(s);
    const mask = new Uint8Array(visible.length);
    for (let i = 0; i < visible.length; i++) if (visible[i] !== 0) mask[i] = 1;
    applySelectionMod(store, mask, "replace");
}

// Anchor the float at its current position and clear it.
export function anchorFloat(store: Store): void {
    if (!store.state.float) return;
    const { pixels, float } = anchorIntoCanvas(store.state);
    store.commit(s => { s.pixels = pixels; s.float = float; }, { history: true });
}

// Anchor (if there's a float) without pushing a snapshot. Caller is
// expected to push history.
export function deselect(store: Store): void {
    if (!store.state.float) return;
    anchorFloat(store);
}
