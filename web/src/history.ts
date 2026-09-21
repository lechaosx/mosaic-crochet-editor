// Undo / redo snapshot stack — persistence-only, dim-aware. Each snapshot
// carries its own `PatternState` so undo crosses dimension / mode changes.
// On QuotaExceededError we drop the oldest snapshot(s) and retry until the new
// one fits — the freshly-added snapshot at the tail is always preserved.

import { PatternState, Float, Axis, GridRecipe } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";
import { axisIsProjectValid, defaultAxes } from "@mosaic/logic/symmetry";
import { normalizeActiveRecipeId, restoreGridRecipes, storedGridRecipes } from "@mosaic/logic/grid-recipes";

const HISTORY_KEY        = "mosaic-history";
const LEGACY_HISTORY_KEY = "mosaic-history-v4";
const HISTORY_VERSION    = 5;
const MAX                = 64;

interface SnapshotV4 {
    state:   PatternState;
    pixels:  string;             // 1-bit-packed, base64
    float:   PackedFloat | null; // bbox-compact float (x/y/w/h + raw pixels)
    axes?:   Axis[];             // Phase-4 axis positions; optional for pre-upgrade blobs
    colorA:  string;
    colorB:  string;
}
interface Snapshot {
    document: {
        state:  PatternState;
        pixels: string;
        colorA: string;
        colorB: string;
    };
    selection: PackedFloat | null;
    transforms: {
        axes?:   Axis[];
        recipes?: unknown[];
        activeRecipeId?: string | null;
    };
}
interface HistoryBlob {
    version:   5;
    snapshots: Snapshot[];
    index:     number;
}

function migrateHistory(value: unknown): HistoryBlob | null {
    if (typeof value !== "object" || value === null) return null;
    const data = value as Record<string, unknown>;
    if (!Array.isArray(data.snapshots) || typeof data.index !== "number") return null;
    if (data.version === HISTORY_VERSION) {
        if (!data.snapshots.every(snapshot => typeof snapshot === "object" && snapshot !== null
            && typeof (snapshot as Record<string, unknown>).document === "object")) return null;
        return data as unknown as HistoryBlob;
    }
    if (data.version !== undefined) return null;
    if (!data.snapshots.every(snapshot => typeof snapshot === "object" && snapshot !== null
        && (snapshot as Record<string, unknown>).state)) return null;
    return {
        version: HISTORY_VERSION,
        snapshots: (data.snapshots as SnapshotV4[]).map(snapshot => ({
            document: {
                state: snapshot.state, pixels: snapshot.pixels,
                colorA: snapshot.colorA, colorB: snapshot.colorB,
            },
            selection: snapshot.float,
            transforms: { axes: snapshot.axes },
        })),
        index: data.index,
    };
}

function read(): HistoryBlob | null {
    const current = localStorage.getItem(HISTORY_KEY);
    const sourceKey = current === null ? LEGACY_HISTORY_KEY : HISTORY_KEY;
    const raw = current ?? localStorage.getItem(LEGACY_HISTORY_KEY);
    if (!raw) return null;
    try {
        const history = migrateHistory(JSON.parse(raw));
        if (!history) return null;
        if (sourceKey === LEGACY_HISTORY_KEY) write(history);
        return history;
    } catch { return null; }
}

function write(h: HistoryBlob) {
    while (true) {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
            localStorage.removeItem(LEGACY_HISTORY_KEY);
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
        document: {
            state: s.pattern, pixels: packPixels(s.pixels),
            colorA: s.colorA, colorB: s.colorB,
        },
        selection: s.float ? packFloat(s.float) : null,
        transforms: { axes: s.axes, recipes: storedGridRecipes(s.recipes), activeRecipeId: s.activeRecipeId },
    };
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
    return a.document.pixels === b.document.pixels
        && JSON.stringify(a.selection) === JSON.stringify(b.selection)
        && JSON.stringify(a.transforms) === JSON.stringify(b.transforms)
        && a.document.colorA === b.document.colorA
        && a.document.colorB === b.document.colorB
        && JSON.stringify(a.document.state) === JSON.stringify(b.document.state);
}

export function historySave(s: Readonly<SessionState>) {
    const h    = read() ?? { version: HISTORY_VERSION, snapshots: [], index: -1 };
    const snap = snapshotFrom(s);
    const head = h.index >= 0 ? h.snapshots[h.index] : null;
    if (head && snapshotsEqual(head, snap)) return;
    h.snapshots.splice(h.index + 1);
    h.snapshots.push(snap);
    if (h.snapshots.length > MAX) h.snapshots.shift();
    h.index = h.snapshots.length - 1;
    write(h);
}

export function historyReplaceCurrent(s: Readonly<SessionState>): boolean {
    const h = read();
    if (!h || h.index < 0) {
        historyReset(s);
        return false;
    }
    h.snapshots.splice(h.index + 1);
    const snap = snapshotFrom(s);
    if (h.index > 0 && snapshotsEqual(h.snapshots[h.index - 1], snap)) {
        h.snapshots.splice(h.index, 1);
        h.index--;
        write(h);
        return false;
    }
    h.snapshots[h.index] = snap;
    write(h);
    return true;
}

export function historyReset(s: Readonly<SessionState>) {
    write({ version: HISTORY_VERSION, snapshots: [snapshotFrom(s)], index: 0 });
}

export function historyEnsureInitialized(s: Readonly<SessionState>) {
    const h = read();
    if (!h || h.snapshots.length === 0) historyReset(s);
}

export function canUndo(): boolean { const h = read(); return h !== null && h.index > 0; }
export function canRedo(): boolean { const h = read(); return h !== null && h.index < h.snapshots.length - 1; }

export interface Restored {
    pattern: PatternState;
    pixels:  Uint8Array;
    float:   Float | null;
    axes:    Axis[];
    recipes: GridRecipe[];
    activeRecipeId: string | null;
    colorA:  string;
    colorB:  string;
}

function restoredAt(h: HistoryBlob): Restored {
    const s = h.snapshots[h.index];
    const axes = s.transforms.axes ?? defaultAxes(
        s.document.state.canvasWidth, s.document.state.canvasHeight,
    );
    const recipes = restoreGridRecipes(s.transforms.recipes);
    const float = s.selection ? unpackFloat(s.selection) : null;
    return {
        pattern: s.document.state,
        pixels:  unpackPixels(s.document.pixels, s.document.state),
        float,
        // Pre-upgrade snapshots have no axes; current fresh sessions also
        // default to an empty list.
        axes:    axes.filter(axis => axisIsProjectValid(axis, s.document.state)),
        recipes,
        activeRecipeId: normalizeActiveRecipeId(
            recipes,
            typeof s.transforms.activeRecipeId === "string" ? s.transforms.activeRecipeId : null,
            float,
        ),
        colorA:  s.document.colorA,
        colorB:  s.document.colorB,
    };
}

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
