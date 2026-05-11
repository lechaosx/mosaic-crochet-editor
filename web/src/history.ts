// Undo / redo snapshot stack — persistence-only. The snapshots live in
// localStorage; there's no in-memory cache. Snapshots use the same 1-bit-per-
// pixel packing as the on-disk pattern format. The (width, height) carried in
// the blob lets us discard stale history if the pattern dimensions changed
// since it was written (different pattern, blob from a prior session, …).
//
// On QuotaExceededError we drop the oldest snapshot(s) and retry until the new
// one fits — the freshly-added snapshot at the tail is always preserved.

import { state } from "./pattern";
import { packPixels, unpackPixels } from "./storage";

const LS_KEY = "mosaic-history-v1";
const MAX    = 64;

interface HistoryBlob {
    width:     number;
    height:    number;
    snapshots: string[];   // 1-bit-packed pixel arrays, base64
    index:     number;
}

function read(): HistoryBlob | null {
    if (!state) return null;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    try {
        const h = JSON.parse(raw) as HistoryBlob;
        if (h.width !== state.canvasWidth || h.height !== state.canvasHeight) return null;
        return h;
    } catch { return null; }
}

function write(h: HistoryBlob) {
    while (true) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(h));
            return;
        } catch (e) {
            if (!(e instanceof DOMException) || e.name !== "QuotaExceededError") throw e;
            // Drop the oldest snapshot to make room for the new one and retry.
            // If a single snapshot can't fit, give up rather than wipe everything.
            if (h.snapshots.length <= 1) return;
            h.snapshots.shift();
            h.index = Math.max(0, h.index - 1);
        }
    }
}

export function historySave(pixels: Uint8Array) {
    if (!state) return;
    const h = read() ?? {
        width: state.canvasWidth, height: state.canvasHeight,
        snapshots: [], index: -1,
    };
    h.snapshots.splice(h.index + 1);
    h.snapshots.push(packPixels(pixels));
    if (h.snapshots.length > MAX) h.snapshots.shift();
    h.index = h.snapshots.length - 1;
    write(h);
}

export function historyReset(pixels: Uint8Array) {
    if (!state) return;
    write({
        width: state.canvasWidth, height: state.canvasHeight,
        snapshots: [packPixels(pixels)], index: 0,
    });
}

// Used on session restore: keep existing history if it matches the current
// pattern dimensions, otherwise seed with a single snapshot.
export function historyEnsureInitialized(pixels: Uint8Array) {
    if (read() === null) historyReset(pixels);
}

export function canUndo(): boolean { const h = read(); return h !== null && h.index > 0; }
export function canRedo(): boolean { const h = read(); return h !== null && h.index < h.snapshots.length - 1; }

export function historyUndo(): Uint8Array | null {
    if (!state) return null;
    const h = read(); if (!h || h.index <= 0) return null;
    h.index--;
    write(h);
    return unpackPixels(h.snapshots[h.index], state);
}

export function historyRedo(): Uint8Array | null {
    if (!state) return null;
    const h = read(); if (!h || h.index >= h.snapshots.length - 1) return null;
    h.index++;
    write(h);
    return unpackPixels(h.snapshots[h.index], state);
}
