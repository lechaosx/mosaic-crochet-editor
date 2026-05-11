// Undo / redo snapshot stack — persistence-only, dim-aware. Each snapshot
// carries its own `PatternState`, so undo crosses dimension / mode changes
// (an Edit Apply that resizes the canvas pushes a snapshot of the *new* state
// onto the stack; undo restores both pixels and state together).
//
// On QuotaExceededError we drop the oldest snapshot(s) and retry until the new
// one fits — the freshly-added snapshot at the tail is always preserved.

import { PatternState } from "./types";
import { state } from "./pattern";
import { packPixels, unpackPixels } from "./storage";

const LS_KEY = "mosaic-history-v2";
const MAX    = 64;

interface Snapshot {
    state:  PatternState;
    pixels: string;   // 1-bit-packed, base64
    colorA: string;
    colorB: string;
}
interface HistoryBlob {
    snapshots: Snapshot[];
    index:     number;
}

function read(): HistoryBlob | null {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    try {
        const h = JSON.parse(raw);
        if (!h || !Array.isArray(h.snapshots) || typeof h.index !== "number") return null;
        if (h.snapshots.length > 0 && (typeof h.snapshots[0] !== "object" || !h.snapshots[0].state)) return null;
        return h as HistoryBlob;
    } catch { return null; }
}

function write(h: HistoryBlob) {
    while (true) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(h));
            return;
        } catch (e) {
            if (!(e instanceof DOMException) || e.name !== "QuotaExceededError") throw e;
            if (h.snapshots.length <= 1) return;
            h.snapshots.shift();
            h.index = Math.max(0, h.index - 1);
        }
    }
}

export function historySave(pixels: Uint8Array, colorA: string, colorB: string) {
    if (!state) return;
    const h = read() ?? { snapshots: [], index: -1 };
    // Skip redundant snapshots — same packed pixels and same colours as the
    // current head means nothing user-visible has changed.
    const packed = packPixels(pixels);
    const head   = h.index >= 0 ? h.snapshots[h.index] : null;
    if (head && head.pixels === packed && head.colorA === colorA && head.colorB === colorB
            && JSON.stringify(head.state) === JSON.stringify(state)) {
        return;
    }
    h.snapshots.splice(h.index + 1);
    h.snapshots.push({ state, pixels: packed, colorA, colorB });
    if (h.snapshots.length > MAX) h.snapshots.shift();
    h.index = h.snapshots.length - 1;
    write(h);
}

export function historyReset(pixels: Uint8Array, colorA: string, colorB: string) {
    if (!state) return;
    write({ snapshots: [{ state, pixels: packPixels(pixels), colorA, colorB }], index: 0 });
}

// Seed history with the current state iff it's empty. Used on session restore
// so existing snapshots survive a refresh untouched.
export function historyEnsureInitialized(pixels: Uint8Array, colorA: string, colorB: string) {
    const h = read();
    if (!h || h.snapshots.length === 0) historyReset(pixels, colorA, colorB);
}

export function canUndo(): boolean { const h = read(); return h !== null && h.index > 0; }
export function canRedo(): boolean { const h = read(); return h !== null && h.index < h.snapshots.length - 1; }

export interface Restored {
    state:  PatternState;
    pixels: Uint8Array;
    colorA: string;
    colorB: string;
}

function snapshotAt(h: HistoryBlob): Restored {
    const s = h.snapshots[h.index];
    return { state: s.state, pixels: unpackPixels(s.pixels, s.state), colorA: s.colorA, colorB: s.colorB };
}

// Read the current head without moving the index — used as the "save point"
// for the Edit popover (open → live-preview → Cancel restores head; Apply
// pushes the new state as the new head).
export function historyPeek(): Restored | null {
    const h = read();
    if (!h || h.index < 0) return null;
    return snapshotAt(h);
}

export function historyUndo(): Restored | null {
    const h = read(); if (!h || h.index <= 0) return null;
    h.index--;
    write(h);
    return snapshotAt(h);
}

export function historyRedo(): Restored | null {
    const h = read(); if (!h || h.index >= h.snapshots.length - 1) return null;
    h.index++;
    write(h);
    return snapshotAt(h);
}
