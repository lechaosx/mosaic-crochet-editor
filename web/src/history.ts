// Undo / redo snapshot stack — persistence-only, dim-aware. Each snapshot
// carries its own `PatternState` so undo crosses dimension / mode changes.
// On QuotaExceededError we drop the oldest snapshot(s) and retry until the new
// one fits — the freshly-added snapshot at the tail is always preserved.

import { PatternState, Float, Axis, MirrorCenter, GridRecipe } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";
import { axisIsProjectValid, migrateAxes, mirrorsForPattern, readMirrorRecords } from "@mosaic/logic/symmetry";
import { normalizeActiveRecipeId, restoreGridRecipes, storedGridRecipes } from "@mosaic/logic/grid-recipes";

const HISTORY_KEY        = "mosaic-history";
const LEGACY_HISTORY_KEY = "mosaic-history-v4";
const HISTORY_VERSION    = 7;
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
        // Missing legacy values preserve the current override; null restores the app default.
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
interface HistoryBlob {
    version:   7;
    snapshots: Snapshot[];
    index:     number;
}

interface LegacySnapshot extends Omit<Snapshot, "transforms"> {
    transforms: { axes?: Axis[]; recipes?: unknown[]; activeRecipeId?: string | null };
}

function migrateSnapshot(snapshot: LegacySnapshot): Snapshot {
    const { axes = [], ...transforms } = snapshot.transforms;
    return { ...snapshot, transforms: { ...transforms,
        mirrors: migrateAxes(axes.filter(axis => axisIsProjectValid(axis, snapshot.document.state)), snapshot.document.state),
    } };
}

function migrateHistory(value: unknown): HistoryBlob | null {
    if (typeof value !== "object" || value === null) return null;
    const data = value as Record<string, unknown>;
    if (!Array.isArray(data.snapshots) || typeof data.index !== "number") return null;
    if (data.version === HISTORY_VERSION || data.version === 6 || data.version === 5) {
        if (!data.snapshots.every(snapshot => typeof snapshot === "object" && snapshot !== null
            && typeof (snapshot as Record<string, unknown>).document === "object")) return null;
        return { version: HISTORY_VERSION, index: data.index,
            snapshots: data.version === HISTORY_VERSION ? data.snapshots as Snapshot[]
                : (data.snapshots as LegacySnapshot[]).map(migrateSnapshot) };
    }
    if (data.version !== undefined) return null;
    if (!data.snapshots.every(snapshot => typeof snapshot === "object" && snapshot !== null
        && (snapshot as Record<string, unknown>).state)) return null;
    return {
        version: HISTORY_VERSION,
        snapshots: (data.snapshots as SnapshotV4[]).map(snapshot => migrateSnapshot({
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
        const parsed = JSON.parse(raw);
        const history = migrateHistory(parsed);
        if (!history) return null;
        if (sourceKey === LEGACY_HISTORY_KEY || parsed.version !== HISTORY_VERSION) write(history);
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
    mirrors: MirrorCenter[];
    recipes: GridRecipe[];
    activeRecipeId: string | null;
    colorA:  string;
    colorB:  string;
    dangerColorOverride?: string | null;
    accentColorOverride?: string | null;
}

function restoredAt(h: HistoryBlob): Restored {
    const s = h.snapshots[h.index];
    const mirrors = readMirrorRecords(s.transforms.mirrors) ?? [];
    const recipes = restoreGridRecipes(s.transforms.recipes);
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
