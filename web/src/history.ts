// Undo / redo snapshot stack, dim-aware: each snapshot carries its own
// `PatternState` so undo crosses dimension / mode changes. `UndoHistory` values are
// immutable; the owner persists each new value with `writeHistory`.

import { PatternState, Float, MirrorCenter, GridRecipe } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";
import { mirrorsForPattern, readMirrorRecords } from "@mosaic/logic/symmetry";
import { normalizeActiveRecipeId, restoreGridRecipes, storedGridRecipes } from "@mosaic/logic/grid-recipes";

const HISTORY_KEY     = "mosaic-history";
const HISTORY_VERSION = 8;
const MAX             = 64;

interface Snapshot {
    document: {
        state:  PatternState;
        pixels: string;
        colorA: string;
        colorB: string;
        // Missing values preserve the current override; null restores the app default.
        dangerColorOverride?: string | null;
        accentColorOverride?: string | null;
    };
    selection: PackedFloat | null;
    transforms: {
        mirrors: MirrorCenter[];
        recipes?: unknown[];
        activeRecipeId?: string | null;
    };
}
export interface UndoHistory {
    readonly snapshots: readonly Snapshot[];
    readonly index:     number;
}
interface HistoryBlob {
    version:   8;
    snapshots: Snapshot[];
    index:     number;
}

// Null when nothing usable is stored.
export function loadHistory(): UndoHistory | null {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (typeof data !== "object" || data === null || data.version !== HISTORY_VERSION
            || !Array.isArray(data.snapshots) || typeof data.index !== "number") return null;
        const snapshots = data.snapshots as unknown[];
        if (!snapshots.every(snapshot => typeof snapshot === "object" && snapshot !== null
            && typeof (snapshot as Record<string, unknown>).document === "object")) return null;
        if ((snapshots as Snapshot[]).some(snapshot => !Array.isArray(snapshot.transforms.recipes)
            || (snapshot.transforms.recipes.length > 0
                && restoreGridRecipes(snapshot.transforms.recipes, false).length !== snapshot.transforms.recipes.length))) return null;
        return snapshots.length > 0 ? { snapshots: snapshots as Snapshot[], index: data.index } : null;
    } catch { return null; }
}

// Returns the history as stored: on QuotaExceededError the oldest snapshots are
// dropped until it fits. If the newest snapshot alone does not fit, nothing is
// written and it is returned alone.
export function writeHistory(h: UndoHistory): UndoHistory {
    const blob: HistoryBlob = { version: HISTORY_VERSION, snapshots: [...h.snapshots], index: h.index };
    while (true) {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(blob));
            break;
        } catch (e) {
            if (!(e instanceof DOMException) || e.name !== "QuotaExceededError") throw e;
            if (blob.snapshots.length <= 1) break;
            blob.snapshots.shift();
            blob.index = Math.max(0, blob.index - 1);
        }
    }
    return { snapshots: blob.snapshots, index: blob.index };
}

function snapshotFrom(s: Readonly<SessionState>): Snapshot {
    return {
        document: {
            state: s.pattern, pixels: packPixels(s.pixels),
            colorA: s.colorA, colorB: s.colorB,
            dangerColorOverride: s.dangerColorOverride,
            accentColorOverride: s.accentColorOverride,
        },
        selection: s.float ? packFloat(s.float) : null,
        transforms: { mirrors: s.mirrors, recipes: storedGridRecipes(s.recipes), activeRecipeId: s.activeRecipeId },
    };
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
    return a.document.pixels === b.document.pixels
        && JSON.stringify(a.selection) === JSON.stringify(b.selection)
        && JSON.stringify(a.transforms) === JSON.stringify(b.transforms)
        && a.document.colorA === b.document.colorA
        && a.document.colorB === b.document.colorB
        && a.document.dangerColorOverride === b.document.dangerColorOverride
        && a.document.accentColorOverride === b.document.accentColorOverride
        && JSON.stringify(a.document.state) === JSON.stringify(b.document.state);
}

export function historyFrom(s: Readonly<SessionState>): UndoHistory {
    return { snapshots: [snapshotFrom(s)], index: 0 };
}

// Returns `h` itself when `s` matches the current snapshot, so the owner can
// skip persisting.
export function historySave(h: UndoHistory, s: Readonly<SessionState>): UndoHistory {
    const snap = snapshotFrom(s);
    const head = h.index >= 0 ? h.snapshots[h.index] : null;
    if (head && snapshotsEqual(head, snap)) return h;
    const snapshots = [...h.snapshots.slice(0, h.index + 1), snap];
    if (snapshots.length > MAX) snapshots.shift();
    return { snapshots, index: snapshots.length - 1 };
}

// `replaced` is false when the current snapshot was instead dropped for matching
// the one before it, or the history was reseeded.
export function historyReplaceCurrent(h: UndoHistory, s: Readonly<SessionState>): { history: UndoHistory; replaced: boolean } {
    if (h.index < 0) return { history: historyFrom(s), replaced: false };
    const snap = snapshotFrom(s);
    const kept = h.snapshots.slice(0, h.index);
    if (h.index > 0 && snapshotsEqual(h.snapshots[h.index - 1], snap)) {
        return { history: { snapshots: kept, index: h.index - 1 }, replaced: false };
    }
    return { history: { snapshots: [...kept, snap], index: h.index }, replaced: true };
}

export function canUndo(h: UndoHistory): boolean { return h.index > 0; }
export function canRedo(h: UndoHistory): boolean { return h.index < h.snapshots.length - 1; }

export function historyUndo(h: UndoHistory): UndoHistory | null {
    return canUndo(h) ? { ...h, index: h.index - 1 } : null;
}

export function historyRedo(h: UndoHistory): UndoHistory | null {
    return canRedo(h) ? { ...h, index: h.index + 1 } : null;
}

export interface Restored {
    pattern: PatternState;
    pixels:  Uint8Array;
    float:   Float | null;
    mirrors: MirrorCenter[];
    recipes: GridRecipe[];
    activeRecipeId: string | null;
    colorA:  string;
    colorB:  string;
    dangerColorOverride?: string | null;
    accentColorOverride?: string | null;
}

export function historyPeek(h: UndoHistory): Restored {
    const s = h.snapshots[h.index];
    const mirrors = readMirrorRecords(s.transforms.mirrors) ?? [];
    const recipes = restoreGridRecipes(s.transforms.recipes, false);
    const float = s.selection ? unpackFloat(s.selection) : null;
    return {
        pattern: s.document.state,
        pixels:  unpackPixels(s.document.pixels, s.document.state),
        float,
        mirrors: mirrorsForPattern(mirrors, s.document.state),
        recipes,
        activeRecipeId: normalizeActiveRecipeId(
            recipes,
            typeof s.transforms.activeRecipeId === "string" ? s.transforms.activeRecipeId : null,
            float,
        ),
        colorA:  s.document.colorA,
        colorB:  s.document.colorB,
        dangerColorOverride: s.document.dangerColorOverride,
        accentColorOverride: s.document.accentColorOverride,
    };
}
