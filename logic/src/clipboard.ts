// Module-level clipboard for selection pixels, plus the three operations
// users invoke from `Ctrl+C` / `Ctrl+X` / `Ctrl+V`. The clipboard stores a
// compact Float (bbox-bounded at original canvas coords). In-memory only —
// never persisted to localStorage, never written to `.mcw`.

import { Float } from "./types";
import { Store } from "./store";
import { cutCells, anchorFloat, deleteFloat } from "./selection";

// The clipboard is just a Float snapshot.
let clipboard: Float | null = null;

// Capture the float into the clipboard. The float is already bbox-bounded
// with absolute coords, so we just copy it. Returns false if no float.
function yankFloat(store: Store): boolean {
    const f = store.state.float;
    if (!f || !f.pixels.some(v => v !== 0)) return false;
    clipboard = { x: f.x, y: f.y, w: f.w, h: f.h, pixels: f.pixels.slice() };
    return true;
}

// Copy: yank to clipboard. Non-destructive — canvas and float are unchanged.
export function copyFloat(store: Store): void {
    yankFloat(store);
}

// Cut: yank to clipboard, drop float. Canvas cells are cleared to baseline only
// when every float cell matches the underlying canvas — any mismatch means the
// canvas is left untouched (only the float is removed).
export function cutFloat(store: Store): void {
    if (!yankFloat(store)) return;
    const s = store.state;
    const f = s.float!;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;

    let allMatch = true;
    outer: for (let ly = 0; ly < f.h; ly++) {
        for (let lx = 0; lx < f.w; lx++) {
            const fv = f.pixels[ly * f.w + lx];
            if (fv === 0) continue;
            const cx = f.x + lx, cy = f.y + ly;
            if (cx < 0 || cx >= W || cy < 0 || cy >= H) { allMatch = false; break outer; }
            const cv = s.pixels[cy * W + cx];
            if (cv === 0 || cv !== fv) { allMatch = false; break outer; }
        }
    }

    const cutMask = new Uint8Array(W * H);
    if (allMatch) {
        for (let ly = 0; ly < f.h; ly++)
            for (let lx = 0; lx < f.w; lx++) {
                const fv = f.pixels[ly * f.w + lx];
                if (fv === 0) continue;
                const cx = f.x + lx, cy = f.y + ly;
                if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
                if (s.pixels[cy * W + cx] !== 0) cutMask[cy * W + cx] = 1;
            }
    }

    const cleared = cutCells(s.pixels, s.pattern, cutMask);
    store.commit(state => { state.pixels = cleared; state.float = null; }, { history: true });
}

// Paste: non-destructive float at original canvas coords. Anchors any prior
// float first. Cells that land on holes are dropped.
export function pasteClipboard(store: Store): boolean {
    if (!clipboard) return false;
    if (store.state.float) anchorFloat(store);

    const W = store.state.pattern.canvasWidth, H = store.state.pattern.canvasHeight;
    const fp = new Uint8Array(clipboard.w * clipboard.h);
    let any = false;
    for (let ly = 0; ly < clipboard.h; ly++) {
        for (let lx = 0; lx < clipboard.w; lx++) {
            const v = clipboard.pixels[ly * clipboard.w + lx];
            if (v === 0) continue;
            const cx = clipboard.x + lx, cy = clipboard.y + ly;
            if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
            if (store.state.pixels[cy * W + cx] === 0) continue;   // hole — drop
            fp[ly * clipboard.w + lx] = v;
            any = true;
        }
    }
    if (!any) return false;
    const newFloat: Float = { x: clipboard.x, y: clipboard.y, w: clipboard.w, h: clipboard.h, pixels: fp };
    store.commit(s => { s.float = newFloat; }, { history: true });
    return true;
}

export function hasClipboard(): boolean { return clipboard !== null; }
