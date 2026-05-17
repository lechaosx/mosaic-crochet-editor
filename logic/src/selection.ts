// Selection / float operations. Pure helpers compute new state; store-mutating
// ops wrap them with `store.commit`.

import { wand_select,
         cut_to_natural_row, cut_to_natural_round } from "@mosaic/wasm";
import { PatternState, Float } from "./types";
import { Store, SessionState, visiblePixels, outOfBounds } from "./store";
import { devAssert, assertNever } from "./dev";

export type SelectMode = "replace" | "add" | "remove";

// ── Pure helpers ─────────────────────────────────────────────────────────────

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

// All-or-nothing match check: returns a canvas-sized cut mask when every
// non-zero float cell matches the underlying canvas pixel; returns null if any
// cell is out of bounds, a hole, or has a different value than the float.
// Callers use the null path to "clear only the float, leave canvas alone."
export function matchedCutMask(
    f: Float, pixels: Uint8Array, pattern: PatternState,
): Uint8Array | null {
    const { canvasWidth: W, canvasHeight: H } = pattern;
    for (let ly = 0; ly < f.h; ly++) {
        for (let lx = 0; lx < f.w; lx++) {
            const fv = f.pixels[ly * f.w + lx];
            if (fv === 0) continue;
            const cx = f.x + lx, cy = f.y + ly;
            if (outOfBounds(cx, cy, W, H)) return null;
            const cv = pixels[cy * W + cx];
            if (cv === 0 || cv !== fv) return null;
        }
    }
    // All float cells are in-bounds, non-hole, and match — build the cut mask.
    const mask = new Uint8Array(W * H);
    for (let ly = 0; ly < f.h; ly++)
        for (let lx = 0; lx < f.w; lx++)
            if (f.pixels[ly * f.w + lx] !== 0)
                mask[(f.y + ly) * W + (f.x + lx)] = 1;
    return mask;
}

// Clip a float to only the cells within canvas bounds.
// Returns null when ALL cells are out of bounds (caller should destroy the float).
// Returns the original float object (no allocation) when nothing needs clipping.
export function clipFloatToCanvas(f: Float, W: number, H: number): Float | null {
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let ly = 0; ly < f.h; ly++) {
        for (let lx = 0; lx < f.w; lx++) {
            if (f.pixels[ly * f.w + lx] === 0) continue;
            const cx = f.x + lx, cy = f.y + ly;
            if (outOfBounds(cx, cy, W, H)) continue;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        }
    }
    if (maxX < 0) return null;
    if (minX === f.x && minY === f.y && maxX === f.x + f.w - 1 && maxY === f.y + f.h - 1) return f;
    const fw = maxX - minX + 1, fh = maxY - minY + 1;
    const fp = new Uint8Array(fw * fh);
    for (let ly = 0; ly < f.h; ly++)
        for (let lx = 0; lx < f.w; lx++) {
            const v = f.pixels[ly * f.w + lx];
            if (v === 0) continue;
            const cx = f.x + lx, cy = f.y + ly;
            if (outOfBounds(cx, cy, W, H)) continue;
            fp[(cy - minY) * fw + (cx - minX)] = v;
        }
    return { x: minX, y: minY, w: fw, h: fh, pixels: fp };
}

// Lift the cells indicated by `liftMask` from `pixels` into a new float.
// Computes the bounding box, creates a compact Float, cuts the canvas.
// Returns `float: null` if no non-hole cells qualify.
export function liftCells(
    pixels: Uint8Array, pattern: PatternState, liftMask: Uint8Array,
): { pixels: Uint8Array; float: Float | null } {
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (liftMask[y * W + x] && pixels[y * W + x] !== 0) {
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return { pixels, float: null };
    const fw = maxX - minX + 1, fh = maxY - minY + 1;
    const fp = new Uint8Array(fw * fh);
    for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++)
            if (liftMask[y * W + x]) fp[(y - minY) * fw + (x - minX)] = pixels[y * W + x];
    return {
        pixels: cutCells(pixels, pattern, liftMask),
        float:  { x: minX, y: minY, w: fw, h: fh, pixels: fp },
    };
}

// Build a rect mask covering (x1,y1)..(x2,y2), skipping hole cells.
export function rectMask(
    pixels: Uint8Array, W: number, H: number,
    x1: number, y1: number, x2: number, y2: number,
): Uint8Array {
    const m = new Uint8Array(W * H);
    const ux1 = Math.max(0, Math.min(x1, x2)), uy1 = Math.max(0, Math.min(y1, y2));
    const ux2 = Math.min(W - 1, Math.max(x1, x2)), uy2 = Math.min(H - 1, Math.max(y1, y2));
    if (ux2 < 0 || ux1 >= W || uy2 < 0 || uy1 >= H) return m;
    for (let y = uy1; y <= uy2; y++)
        for (let x = ux1; x <= ux2; x++)
            if (pixels[y * W + x] !== 0) m[y * W + x] = 1;
    return m;
}

// Canvas-sized mask of which cells the float currently covers (for paint
// clipping and hit-testing).
export function shiftedFloatMask(s: SessionState): Uint8Array {
    const { canvasWidth: W, canvasHeight: H } = s.pattern;
    const out = new Uint8Array(W * H);
    if (!s.float) return out;
    const f = s.float;
    for (let ly = 0; ly < f.h; ly++) {
        for (let lx = 0; lx < f.w; lx++) {
            if (f.pixels[ly * f.w + lx] === 0) continue;
            const cx = f.x + lx, cy = f.y + ly;
            if (outOfBounds(cx, cy, W, H)) continue;
            out[cy * W + cx] = 1;
        }
    }
    return out;
}

// Bake the float into the canvas; return pixels with float stamped + float=null.
export function anchorIntoCanvas(s: SessionState): { pixels: Uint8Array; float: null } {
    return { pixels: visiblePixels(s), float: null };
}

// ── Store-mutating selection ops ─────────────────────────────────────────────

export function applySelectionMod(store: Store, region: Uint8Array, mode: SelectMode): void {
    const s = store.state;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;

    if (mode === "replace") {
        const base = s.float ? visiblePixels(s) : s.pixels;
        const lifted = liftCells(base, s.pattern, region);
        store.commit(state => { state.pixels = lifted.pixels; state.float = lifted.float; }, { history: true });
        return;
    }

    if (!s.float) {
        if (mode === "add") {
            const lifted = liftCells(s.pixels, s.pattern, region);
            store.commit(state => { state.pixels = lifted.pixels; state.float = lifted.float; }, { history: true });
        }
        return;
    }

    const f = s.float;

    if (mode === "add") {
        // Determine which region cells are new (not already in the float at this canvas position)
        let newMinX = W, newMinY = H, newMaxX = -1, newMaxY = -1;
        const cutMask = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (!region[y * W + x] || s.pixels[y * W + x] === 0) continue;
                const lx = x - f.x, ly = y - f.y;
                // Already in float?
                if (lx >= 0 && lx < f.w && ly >= 0 && ly < f.h && f.pixels[ly * f.w + lx] !== 0) continue;
                cutMask[y * W + x] = 1;
                if (x < newMinX) newMinX = x; if (x > newMaxX) newMaxX = x;
                if (y < newMinY) newMinY = y; if (y > newMaxY) newMaxY = y;
            }
        }
        if (newMaxX < 0) return; // nothing new

        // Expand bounding box to contain both old float and new cells
        const eMinX = Math.min(f.x, newMinX), eMinY = Math.min(f.y, newMinY);
        const eMaxX = Math.max(f.x + f.w - 1, newMaxX), eMaxY = Math.max(f.y + f.h - 1, newMaxY);
        const ew = eMaxX - eMinX + 1, eh = eMaxY - eMinY + 1;
        const ep = new Uint8Array(ew * eh);

        // Copy existing float into expanded array
        for (let ly = 0; ly < f.h; ly++)
            for (let lx = 0; lx < f.w; lx++) {
                const v = f.pixels[ly * f.w + lx];
                if (v !== 0) ep[(f.y + ly - eMinY) * ew + (f.x + lx - eMinX)] = v;
            }

        // Add new cells
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++)
                if (cutMask[y * W + x])
                    ep[(y - eMinY) * ew + (x - eMinX)] = s.pixels[y * W + x];

        const newPixels = cutCells(s.pixels, s.pattern, cutMask);
        store.commit(state => {
            state.pixels = newPixels;
            state.float  = { x: eMinX, y: eMinY, w: ew, h: eh, pixels: ep };
        }, { history: true });
        return;
    }

    if (mode !== "remove") assertNever(mode, "applySelectionMod");

    // Remove: stamp overlapping cells back to canvas, zero them in float
    const newCanvasPixels = s.pixels.slice();
    const newFP = f.pixels.slice();
    let removed = false;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (!region[y * W + x]) continue;
            const lx = x - f.x, ly = y - f.y;
            if (lx < 0 || lx >= f.w || ly < 0 || ly >= f.h) continue;
            const fi = ly * f.w + lx;
            if (newFP[fi] === 0) continue;
            if (newCanvasPixels[y * W + x] === 0) continue; // hole
            newCanvasPixels[y * W + x] = newFP[fi];
            newFP[fi] = 0;
            removed = true;
        }
    }
    if (!removed) return;
    const anyLeft = newFP.some(v => v !== 0);
    store.commit(state => {
        state.pixels = newCanvasPixels;
        state.float  = anyLeft ? { ...f, pixels: newFP } : null;
    }, { history: true });
}

export function commitSelectRect(
    store: Store, x1: number, y1: number, x2: number, y2: number, mode: SelectMode,
): void {
    const s = store.state;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    const visible = visiblePixels(s);
    const region  = rectMask(visible, W, H, x1, y1, x2, y2);
    applySelectionMod(store, region, mode);
}

export function commitWandAt(store: Store, x: number, y: number, mode: SelectMode): void {
    const s = store.state;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    devAssert(x >= 0 && x < W && y >= 0 && y < H, "commitWandAt out of bounds");
    const visible = visiblePixels(s);
    if (visible[y * W + x] === 0) return;
    const region = wand_select(visible, W, H, x, y, 0, new Uint8Array(0));
    applySelectionMod(store, region, mode);
}

export function selectAll(store: Store): void {
    const s = store.state;
    const visible = visiblePixels(s);
    const mask = new Uint8Array(visible.length);
    visible.forEach((v, i) => { if (v !== 0) mask[i] = 1; });
    applySelectionMod(store, mask, "replace");
}

export function anchorFloat(store: Store): void {
    if (!store.state.float) return;
    const { pixels, float } = anchorIntoCanvas(store.state);
    store.commit(s => { s.pixels = pixels; s.float = float; }, { history: true });
}

export function deselect(store: Store): void {
    if (!store.state.float) return;
    anchorFloat(store);
}

// Delete: all-or-nothing. If every float cell matches the canvas, cut canvas to
// baseline and re-lift so the selection stays active (pressing Delete twice
// always clears both). If any cell differs, re-lift canvas as-is — canvas untouched.
export function deleteFloat(store: Store): void {
    if (!store.state.float) return;
    const s = store.state;
    const f = s.float!;
    const { canvasWidth: W, canvasHeight: H } = s.pattern;
    const cutMask = matchedCutMask(f, s.pixels, s.pattern);
    const cleared = cutMask ? cutCells(s.pixels, s.pattern, cutMask) : s.pixels;
    const newFP = new Uint8Array(f.w * f.h);
    for (let ly = 0; ly < f.h; ly++) {
        for (let lx = 0; lx < f.w; lx++) {
            if (f.pixels[ly * f.w + lx] === 0) continue;
            const cx = f.x + lx, cy = f.y + ly;
            if (outOfBounds(cx, cy, W, H)) continue;
            if (cleared[cy * W + cx] === 0) continue;
            newFP[ly * f.w + lx] = cleared[cy * W + cx];
        }
    }
    store.commit(state => { state.pixels = cleared; state.float = { ...f, pixels: newFP }; }, { history: true });
}
