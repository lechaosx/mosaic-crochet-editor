// Undo / redo snapshot stack — persistence-only, dim-aware. Each snapshot
// carries its own `PatternState` so undo crosses dimension / mode changes.
// On QuotaExceededError we drop the oldest snapshot(s) and retry until the new
// one fits — the freshly-added snapshot at the tail is always preserved.

import { PatternState } from "./types";
import { SessionState } from "./store";
import { packPixels, unpackPixels, packSelection, unpackSelection } from "./storage";

const LS_KEY = "mosaic-history-v2";
const MAX    = 64;

interface Snapshot {
    state:     PatternState;
    pixels:    string;          // 1-bit-packed, base64
    selection: string | null;   // 1-bit-packed bitset, or null when no selection
    colorA:    string;
    colorB:    string;
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

function snapshotFrom(s: Readonly<SessionState>): Snapshot {
    return {
        state:     s.pattern,
        pixels:    packPixels(s.pixels),
        selection: s.selection ? packSelection(s.selection) : null,
        colorA:    s.colorA,
        colorB:    s.colorB,
    };
}

export function historySave(s: Readonly<SessionState>) {
    const h    = read() ?? { snapshots: [], index: -1 };
    const snap = snapshotFrom(s);
    // Skip redundant snapshots — same packed pixels, selection, colours, and
    // dims as the current head means nothing user-visible has changed.
    const head = h.index >= 0 ? h.snapshots[h.index] : null;
    if (head && head.pixels === snap.pixels && head.selection === snap.selection
            && head.colorA === snap.colorA && head.colorB === snap.colorB
            && JSON.stringify(head.state) === JSON.stringify(snap.state)) {
        return;
    }
    h.snapshots.splice(h.index + 1);
    h.snapshots.push(snap);
    if (h.snapshots.length > MAX) h.snapshots.shift();
    h.index = h.snapshots.length - 1;
    write(h);
}

export function historyReset(s: Readonly<SessionState>) {
    write({ snapshots: [snapshotFrom(s)], index: 0 });
}

// Seed history with the current state iff it's empty. Used on session restore
// so existing snapshots survive a refresh untouched.
export function historyEnsureInitialized(s: Readonly<SessionState>) {
    const h = read();
    if (!h || h.snapshots.length === 0) historyReset(s);
}

export function canUndo(): boolean { const h = read(); return h !== null && h.index > 0; }
export function canRedo(): boolean { const h = read(); return h !== null && h.index < h.snapshots.length - 1; }

// Snapshots carry pattern + pixels + selection + colours — the rest of
// SessionState (tool / settings / view) is unchanged by undo/redo. Caller
// merges these fields into the live session.
export interface Restored {
    pattern:   PatternState;
    pixels:    Uint8Array;
    selection: Uint8Array | null;
    colorA:    string;
    colorB:    string;
}

function restoredAt(h: HistoryBlob): Restored {
    const s = h.snapshots[h.index];
    return {
        pattern:   s.state,
        pixels:    unpackPixels(s.pixels, s.state),
        selection: s.selection
                    ? unpackSelection(s.selection, s.state.canvasWidth * s.state.canvasHeight)
                    : null,
        colorA:    s.colorA,
        colorB:    s.colorB,
    };
}

// Read the current head without moving the index — used as the "save point"
// for the Edit popover (live preview reverts back to this on no-op close).
export function historyPeek(): Restored | null {
    const h = read();
    if (!h || h.index < 0) return null;
    return restoredAt(h);
}

export function historyUndo(): Restored | null {
    const h = read(); if (!h || h.index <= 0) return null;
    h.index--;
    write(h);
    return restoredAt(h);
}

export function historyRedo(): Restored | null {
    const h = read(); if (!h || h.index >= h.snapshots.length - 1) return null;
    h.index++;
    write(h);
    return restoredAt(h);
}
