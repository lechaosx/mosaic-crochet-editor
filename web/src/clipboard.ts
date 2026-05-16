// Module-level clipboard for selection pixels + mask, plus the three
// operations users invoke from `Ctrl+C` / `Ctrl+X` / `Ctrl+V`. Stored
// tightly bbox-bounded with the original canvas top-left, so paste lands
// at the same visual position. In-memory only — never persisted to
// localStorage, never written to `.mcw`.

import { Float } from "./types";
import { Store, visiblePixels } from "./store";
import { cutCells, shiftedFloatMask, anchorFloat } from "./selection";

interface ClipboardData {
    pixels:  Uint8Array;
    mask:    Uint8Array;
    w:       number;
    h:       number;
    originX: number;
    originY: number;
}
let clipboard: ClipboardData | null = null;

// Capture the current float (bbox-bounded, in canvas coords) into the
// clipboard. Returns `false` if there's no float to capture. Does NOT
// mutate canvas or float — pairs with copy/cut's separate canvas effect.
function yankFloat(store: Store): boolean {
    const f = store.state.float;
    if (!f) return false;
    const W = store.state.pattern.canvasWidth, H = store.state.pattern.canvasHeight;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let sy = 0; sy < H; sy++) {
        for (let sx = 0; sx < W; sx++) {
            if (f.mask[sy * W + sx] === 0) continue;
            const cx = sx + f.dx, cy = sy + f.dy;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        }
    }
    if (maxX < 0) return false;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const cbPixels = new Uint8Array(bw * bh);
    const cbMask   = new Uint8Array(bw * bh);
    for (let sy = 0; sy < H; sy++) {
        for (let sx = 0; sx < W; sx++) {
            if (f.mask[sy * W + sx] === 0) continue;
            const cx = sx + f.dx, cy = sy + f.dy;
            const bx = cx - minX, by = cy - minY;
            cbPixels[by * bw + bx] = f.pixels[sy * W + sx];
            cbMask[by * bw + bx]   = 1;
        }
    }
    clipboard = { pixels: cbPixels, mask: cbMask, w: bw, h: bh, originX: minX, originY: minY };
    return true;
}

// Copy: yank to clipboard AND stamp the float into the base canvas at its
// current position. The float stays alive on top — the user can keep
// moving it; the stamp is "I'm OK with this content being here too."
export function copyFloat(store: Store): void {
    if (!yankFloat(store)) return;
    const newPixels = visiblePixels(store.state);
    store.commit(s => { s.pixels = newPixels; }, { history: true });
}

// Cut: yank to clipboard AND clear the base canvas under the float
// (delete-key semantics). Drops the float — the destructive op closes
// the selection. A follow-up `paste` brings the content back at the cut
// location.
export function cutFloat(store: Store): void {
    if (!yankFloat(store)) return;
    const shifted = shiftedFloatMask(store.state);
    const cleared = cutCells(store.state.pixels, store.state.pattern, shifted);
    store.commit(s => { s.pixels = cleared; s.float = null; }, { history: true });
}

// Paste from the clipboard at its original canvas coords as a
// non-destructive uncut float — `pixels` underneath stays put. Anchors
// any prior float first (separate snapshot). Caller is responsible for
// switching to the Move tool (we don't import the UI from here).
export function pasteClipboard(store: Store): boolean {
    if (!clipboard) return false;
    if (store.state.float) anchorFloat(store);

    const W = store.state.pattern.canvasWidth, H = store.state.pattern.canvasHeight;
    const mask   = new Uint8Array(W * H);
    const pixels = new Uint8Array(W * H);
    let any = false;
    for (let dy = 0; dy < clipboard.h; dy++) {
        for (let dx = 0; dx < clipboard.w; dx++) {
            if (clipboard.mask[dy * clipboard.w + dx] === 0) continue;
            const cx = clipboard.originX + dx, cy = clipboard.originY + dy;
            if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
            if (store.state.pixels[cy * W + cx] === 0) continue;   // hole — drop
            mask[cy * W + cx]   = 1;
            pixels[cy * W + cx] = clipboard.pixels[dy * clipboard.w + dx];
            any = true;
        }
    }
    if (!any) return false;
    const newFloat: Float = { mask, pixels, dx: 0, dy: 0 };
    store.commit(s => { s.float = newFloat; }, { history: true });
    return true;
}

export function hasClipboard(): boolean { return clipboard !== null; }
