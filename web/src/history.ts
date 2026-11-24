// Undo / redo snapshot stack, dim-aware: each snapshot carries its own
// `PatternState` so undo crosses dimension / mode changes. `UndoHistory` values are
// immutable; the owner stores each new value as the records `historyChanges` lists.

import { PatternState, Float, MirrorCenter, GridRecipe } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";
import { mirrorsForPattern, readMirrorRecords } from "@mosaic/logic/symmetry";
import { normalizeActiveRecipeId, restoreGridRecipes, storedGridRecipes } from "@mosaic/logic/grid-recipes";
import { assertPatternDimensions, samePatternGeometry } from "@mosaic/logic/pattern";

const HISTORY_VERSION = 10;
const MAX             = 64;
const HEX_COLOR       = /^#[0-9a-f]{6}$/i;

export interface Snapshot {
    id: number;
    document: {
        state:  PatternState;
        pixels: string;
        colorA: string;
        colorB: string;
        dangerColorOverride: string | null;
        accentColorOverride: string | null;
    };
    selection: PackedFloat | null;
    transforms: {
        mirrors: MirrorCenter[];
        recipes: unknown[];
        activeRecipeId: string | null;
    };
}
export interface UndoHistory {
    readonly snapshots: readonly Snapshot[];
    readonly index:     number;
    // Ids restart only in a new history, which has no clean snapshot yet, so a
    // replaced or dropped snapshot never matches `cleanId` again.
    readonly nextId:    number;
    // The snapshot whose content was last saved to a file, or that a new,
    // opened or example project started from.
    readonly cleanId:   number | null;
}
// Stored next to one record per snapshot, so a change rewrites only the
// snapshots it adds. Ids increase along `ids`.
export interface HistoryMeta {
    version: 10;
    ids:     number[];
    index:   number;
    nextId:  number;
    cleanId: number | null;
}

// `written` is the history the stored records already hold, or null when they
// may hold anything.
export function historyChanges(written: UndoHistory | null, next: UndoHistory): { meta: HistoryMeta; put: Snapshot[] } {
    const stored = new Set(written?.snapshots);
    return {
        meta: { version: HISTORY_VERSION, ids: next.snapshots.map(snapshot => snapshot.id),
            index: next.index, nextId: next.nextId, cleanId: next.cleanId },
        put: next.snapshots.filter(snapshot => !stored.has(snapshot)),
    };
}

function isHexColor(value: unknown): boolean {
    return typeof value === "string" && HEX_COLOR.test(value);
}

function isStoredSnapshot(value: unknown): value is Snapshot {
    if (typeof value !== "object" || value === null) return false;
    const { id, document, selection, transforms } = value as Partial<Snapshot>;
    if (!Number.isSafeInteger(id) || typeof document !== "object" || document === null
        || typeof transforms !== "object" || transforms === null) return false;
    assertPatternDimensions(document.state);
    const cells = document.state.canvasWidth * document.state.canvasHeight;
    if (typeof document.pixels !== "string" || document.pixels.length !== 4 * Math.ceil(Math.ceil(cells / 8) / 3)
        || !isHexColor(document.colorA) || !isHexColor(document.colorB)
        || (document.dangerColorOverride !== null && !isHexColor(document.dangerColorOverride))
        || (document.accentColorOverride !== null && !isHexColor(document.accentColorOverride))) return false;
    if (selection !== null && (typeof selection !== "object"
        || ![selection.x, selection.y, selection.w, selection.h].every(Number.isSafeInteger)
        || typeof selection.pixels !== "string" || selection.pixels.length !== 4 * Math.ceil(selection.w * selection.h / 3))) return false;
    const { mirrors, recipes, activeRecipeId } = transforms;
    return readMirrorRecords(mirrors) !== null
        && Array.isArray(recipes)
        && (recipes.length === 0 || restoreGridRecipes(recipes, false).length === recipes.length)
        && (activeRecipeId === null || typeof activeRecipeId === "string");
}

// Null when the records hold no complete, valid history. Stored snapshots the
// metadata doesn't list are ignored.
export function historyFromStored(meta: unknown, snapshots: readonly unknown[]): UndoHistory | null {
    if (typeof meta !== "object" || meta === null) return null;
    const { version, ids, index, nextId, cleanId } = meta as Partial<HistoryMeta>;
    if (version !== HISTORY_VERSION || !Array.isArray(ids) || ids.length === 0
        || !Number.isSafeInteger(index) || index! < 0 || index! >= ids.length
        || !Number.isSafeInteger(nextId) || (cleanId !== null && !Number.isSafeInteger(cleanId))) return null;
    try {
        const byId = new Map(snapshots.filter(isStoredSnapshot).map(snapshot => [snapshot.id, snapshot]));
        const listed = ids.map(id => byId.get(id));
        if (listed.some((snapshot, i) => snapshot === undefined || snapshot.id >= nextId!
            || (i > 0 && snapshot.id <= ids[i - 1]))) return null;
        return { snapshots: listed as Snapshot[], index: index!, nextId: nextId!, cleanId: cleanId! };
    } catch { return null; }
}

function snapshotFrom(s: Readonly<SessionState>, id: number, pixels = packPixels(s.pixels)): Snapshot {
    return {
        id,
        document: {
            state: s.pattern, pixels,
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
    return { snapshots: [snapshotFrom(s, 0)], index: 0, nextId: 1, cleanId: null };
}

// Returns `h` itself when `s` matches the current snapshot, so the owner can
// skip persisting. `pixels`, here and below, is `s.pixels` packed, when the
// caller has it already.
export function historySave(h: UndoHistory, s: Readonly<SessionState>, pixels?: string): UndoHistory {
    const snap = snapshotFrom(s, h.nextId, pixels);
    if (snapshotsEqual(h.snapshots[h.index], snap)) return h;
    const snapshots = [...h.snapshots.slice(0, h.index + 1), snap];
    if (snapshots.length > MAX) snapshots.shift();
    return { ...h, snapshots, index: snapshots.length - 1, nextId: h.nextId + 1 };
}

// `replaced` is false when the current snapshot was instead dropped for matching
// the one before it.
export function historyReplaceCurrent(h: UndoHistory, s: Readonly<SessionState>, pixels?: string): { history: UndoHistory; replaced: boolean } {
    const snap = snapshotFrom(s, h.nextId, pixels);
    const kept = h.snapshots.slice(0, h.index);
    if (h.index > 0 && snapshotsEqual(h.snapshots[h.index - 1], snap)) {
        return { history: { ...h, snapshots: kept, index: h.index - 1 }, replaced: false };
    }
    return { history: { ...h, snapshots: [...kept, snap], nextId: h.nextId + 1 }, replaced: true };
}

export function historyHeadId(h: UndoHistory): number {
    return h.snapshots[h.index].id;
}

// `id` defaults to the current snapshot; pass the one captured when a save
// began, as edits may land before the file is written.
export function historyMarkClean(h: UndoHistory, id = historyHeadId(h)): UndoHistory {
    return { ...h, cleanId: id };
}

export function isClean(h: UndoHistory): boolean {
    return h.cleanId === historyHeadId(h);
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
    // `pixels` packed.
    packedPixels: string;
    float:   Float | null;
    mirrors: MirrorCenter[];
    recipes: GridRecipe[];
    activeRecipeId: string | null;
    colorA:  string;
    colorB:  string;
    dangerColorOverride: string | null;
    accentColorOverride: string | null;
}

// `shown`, the state the restored one replaces, lends its holes when it has
// the same geometry.
export function historyPeek(h: UndoHistory, shown?: Pick<SessionState, "pattern" | "pixels">): Restored {
    const s = h.snapshots[h.index];
    const mirrors = readMirrorRecords(s.transforms.mirrors) ?? [];
    const recipes = restoreGridRecipes(s.transforms.recipes, false);
    const float = s.selection ? unpackFloat(s.selection) : null;
    return {
        pattern: s.document.state,
        pixels:  unpackPixels(s.document.pixels, s.document.state,
            shown && samePatternGeometry(shown.pattern, s.document.state) ? shown.pixels : undefined),
        packedPixels: s.document.pixels,
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
