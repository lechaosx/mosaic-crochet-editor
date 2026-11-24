// History (undo/redo) tests.

import { describe, test, expect } from "vitest";
import { serialize } from "node:v8";
import {
    historyFrom, historySave, historyReplaceCurrent, historyChanges, historyFromStored,
    historyUndo, historyRedo, canUndo, canRedo, historyPeek, historyHeadId, historyMarkClean, isClean,
    UndoHistory,
} from "../src/history";
import { rowSession, filledPixels, makeFloat } from "./_helpers";
import { addMirror } from "@mosaic/logic/symmetry";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";
import { encodeMcw } from "@mosaic/logic/mcw";

// The history as read back from its stored records.
function reloaded(h: UndoHistory): UndoHistory | null {
    const { meta, put } = historyChanges(null, h);
    return historyFromStored(structuredClone(meta), structuredClone(put));
}

// Stored records of `h` with `edit` applied to its first snapshot.
function storedWith(h: UndoHistory, edit: (snapshot: any) => void) {
    const { meta, put } = structuredClone(historyChanges(null, h));
    edit(put[0]);
    return historyFromStored(meta, put);
}

describe("historyFrom / historySave", () => {
    test("chosen tool variants do not create an authored history action", () => {
        const session = rowSession(3, 3);
        const h = historySave(historyFrom(session), { ...session, toolVariants: { select: "add", wand: "remove", move: "duplicate", overlay: "invert" } });
        expect(canUndo(h)).toBe(false);
        expect(historyPeek(h)).not.toHaveProperty("toolVariants");
    });
    test("historyFrom seeds a single snapshot at index 0", () => {
        const h = historyFrom(rowSession(3, 3));
        expect(canUndo(h)).toBe(false);
        expect(canRedo(h)).toBe(false);
        expect(h.index).toBe(0);
        expect(historyPeek(h)).not.toBeNull();
    });

    test("save pushes a new snapshot, enabling undo", () => {
        const h = historySave(historyFrom(rowSession(3, 3)), rowSession(3, 3, { pixels: filledPixels(3, 3, 2) }));
        expect(canUndo(h)).toBe(true);
    });

    test("save dedupes against the head (no-op state push doesn't grow history)", () => {
        const s = rowSession(3, 3);
        const h = historyFrom(s);
        expect(historySave(h, s)).toBe(h);   // identical state
        expect(canUndo(h)).toBe(false);
    });

    test("replace current updates an edit's redo state without losing its undo baseline", () => {
        const baseline = rowSession(3, 3);
        let h = historySave(historyFrom(baseline), rowSession(4, 3));

        h = historyReplaceCurrent(h, rowSession(4, 5)).history;

        h = historyUndo(h)!;
        expect(historyPeek(h).pattern).toEqual(baseline.pattern);
        h = historyRedo(h)!;
        expect(historyPeek(h).pattern.canvasWidth).toBe(4);
        expect(historyPeek(h).pattern.canvasHeight).toBe(5);
    });

    test("replace current removes a coalesced edit that returned to its baseline", () => {
        const baseline = rowSession(3, 3);
        const { history: h, replaced } = historyReplaceCurrent(historySave(historyFrom(baseline), rowSession(4, 3)), baseline);

        expect(replaced).toBe(false);

        expect(canUndo(h)).toBe(false);
        expect(historyPeek(h).pattern).toEqual(baseline.pattern);
    });

    test("float changes are part of the dedupe key — pushing a float pushes a snapshot", () => {
        const s = rowSession(3, 3);
        const h = historySave(historyFrom(s), { ...s, float: makeFloat([{ x: 0, y: 0, v: 1 }]) });
        expect(canUndo(h)).toBe(true);
    });

    test("axis changes are part of the dedupe key — adding an axis pushes a snapshot", () => {
        const s = rowSession(3, 3);
        const h = historySave(historyFrom(s), { ...s, mirrors: addMirror([], "V", { mode: "row", canvasWidth: 3, canvasHeight: 3 }) });
        expect(canUndo(h)).toBe(true);
    });

    test("project contrast overrides are authored history, including explicit defaults", () => {
        const baseline = rowSession(3, 3);
        let h = historySave(historyFrom(baseline), { ...baseline, dangerColorOverride: "#123456", accentColorOverride: "#abcdef" });
        expect(canUndo(h)).toBe(true);
        h = historyUndo(h)!;
        expect(historyPeek(h)).toMatchObject({ dangerColorOverride: null, accentColorOverride: null });
        h = historyRedo(h)!;
        expect(historyPeek(h)).toMatchObject({ dangerColorOverride: "#123456", accentColorOverride: "#abcdef" });
        h = historySave(h, baseline);
        expect(historyPeek(h)).toMatchObject({ dangerColorOverride: null, accentColorOverride: null });
    });

    test("saved recipes are part of history and survive undo", () => {
        const s = rowSession(3, 3);
        const float = makeFloat([{ x: 0, y: 0, v: 1 }]);
        const recipe = gridRecipeFromFloat(float);
        let h = historySave(historyFrom(s), {
            ...s,
            float, recipes: [recipe], activeRecipeId: recipe.id,
        });

        expect(canUndo(h)).toBe(true);
        h = historyUndo(h)!;
        expect(historyPeek(h).recipes).toHaveLength(1);
        expect(historyPeek(h).recipes[0].source.mask).toHaveLength(0);
        h = historyRedo(h)!;
        expect(historyPeek(h).recipes).toEqual([recipe]);
        expect(historyPeek(h).activeRecipeId).toBe(recipe.id);
    });

    test("history clears an active recipe whose restored float does not match its source", () => {
        const source = makeFloat([{ x: 0, y: 0, v: 1 }]);
        const recipe = gridRecipeFromFloat(source);
        const h = historyFrom(rowSession(3, 3, {
            recipes: [recipe],
            activeRecipeId: recipe.id,
            float: makeFloat([{ x: 1, y: 0, v: 1 }]),
        }));

        expect(historyPeek(h).activeRecipeId).toBeNull();
    });

    test("history retains alternate gaps in current records", () => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 1 }]));
        recipe.columnSpacingAlternate = 7;
        recipe.rowSpacingAlternate = 8;
        expect(historyPeek(reloaded(historyFrom(rowSession(3, 3, { recipes: [recipe] })))!).recipes[0]).toMatchObject({
            columnSpacingAlternate: 7,
            rowSpacingAlternate: 8,
        });
    });

    test("a sparse saved-recipe mask survives a reload of the history", () => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 0, y: 0, v: 1 }, { x: 2, y: 0, v: 2 }, { x: 1, y: 3, v: 1 }]));
        expect(historyPeek(reloaded(historyFrom(rowSession(5, 5, { recipes: [recipe] })))!).recipes).toEqual([recipe]);
    });

    test("a snapshot stores a saved-recipe mask in well under a byte per cell", () => {
        const n = 1000;
        const recipe = gridRecipeFromFloat({ x: 0, y: 0, w: n, h: n, pixels: new Uint8Array(n * n).fill(1) });
        const { put } = historyChanges(null, historyFrom(rowSession(n, n, { recipes: [recipe] })));
        expect(serialize(put[0]).length).toBeLessThan(n * n / 2);
    });

    test("axis position survives undo: add V, drag to x=0, undo restores canonical", () => {
        const s = rowSession(3, 3);
        // Snapshot 1: V added at canonical x=1.
        const v1 = addMirror([], "V", { mode: "row", canvasWidth: 3, canvasHeight: 3 });
        let h = historySave(historyFrom(s), { ...s, mirrors: v1 });
        // Snapshot 2: V moved to x=0 (same id, new position).
        const v2 = v1.map(a => a.types.includes("V") ? { ...a, x: 0 } : a);
        h = historySave(h, { ...s, mirrors: v2 });
        // Undo back to V@x=1.
        const undone = historyUndo(h);
        expect(undone).not.toBeNull();
        const v = historyPeek(undone!).mirrors.find(a => a.types.includes("V"))!;
        expect(v.types.includes("V") && v.x === 1).toBe(true);
    });

    test("undo drops stale mirrors but retains valid disabled mirrors", () => {
        const valid = { id: "valid", types: ["V" as const], enabled: false, x: 1, y: 1 };
        const stale = { id: "stale", types: ["H" as const], enabled: true, x: 1, y: 0 };
        const baseline = rowSession(3, 3, { mirrors: [valid, stale] });
        const h = historySave(historyFrom(baseline), { ...baseline, colorA: "#abcdef" });

        const restored = historyPeek(historyUndo(h)!);
        expect(restored.mirrors).toEqual([valid]);
        expect(() => encodeMcw(restored)).not.toThrow();
    });
});

describe("historyUndo / Redo navigation", () => {
    test("undo + redo restore the same state", () => {
        const saved = historySave(historyFrom(rowSession(3, 3)), rowSession(3, 3, { pixels: filledPixels(3, 3, 2) }));
        const undone = historyUndo(saved);
        expect(undone).not.toBeNull();
        expect(canUndo(undone!)).toBe(false);
        expect(canRedo(undone!)).toBe(true);
        const redone = historyRedo(undone!);
        expect(redone).not.toBeNull();
        expect(canRedo(redone!)).toBe(false);
        expect(historyPeek(undone!).pixels).toEqual(rowSession(3, 3).pixels);
        expect(historyPeek(redone!).pixels).toEqual(filledPixels(3, 3, 2));
    });

    test("save after undo truncates the redo branch", () => {
        let h = historySave(historyFrom(rowSession(3, 3)), rowSession(3, 3, { pixels: filledPixels(3, 3, 2) }));   // S1
        h = historyUndo(h)!;
        h = historySave(h, rowSession(3, 3, { colorA: "#abc123" }));                                          // S1'
        expect(canRedo(h)).toBe(false);
    });

    test("undo at the bottom returns null", () => {
        expect(historyUndo(historyFrom(rowSession(3, 3)))).toBeNull();
    });

    test("redo at the top returns null", () => {
        expect(historyRedo(historyFrom(rowSession(3, 3)))).toBeNull();
    });
});

describe("historyPeek", () => {
    test("returns current head without moving the index", () => {
        const h = historyFrom(rowSession(3, 3, { colorA: "#aabbcc" }));
        expect(historyPeek(h).colorA).toBe("#aabbcc");
        // Index didn't move:
        expect(canUndo(h)).toBe(false);
    });
});

describe("save point", () => {
    const base = rowSession(3, 3);
    const edited = rowSession(3, 3, { colorA: "#123456" });
    const other = rowSession(3, 3, { colorA: "#abcdef" });

    test("a new history is unsaved until marked clean", () => {
        expect(isClean(historyFrom(base))).toBe(false);
        expect(isClean(historyMarkClean(historyFrom(base)))).toBe(true);
    });

    test("an edit makes the project dirty and undoing back to the save point makes it clean", () => {
        let h = historySave(historyMarkClean(historyFrom(base)), edited);
        expect(isClean(h)).toBe(false);
        h = historyUndo(h)!;
        expect(isClean(h)).toBe(true);
        h = historyRedo(h)!;
        expect(isClean(h)).toBe(false);
    });

    test("editing after undoing past the save point stays dirty, even back at the saved content", () => {
        let h = historyMarkClean(historySave(historyFrom(base), edited));
        h = historySave(historyUndo(h)!, edited);
        expect(isClean(h)).toBe(false);
        h = historyRedo(historyUndo(h)!)!;
        expect(isClean(h)).toBe(false);
    });

    test("replacing the saved snapshot makes the project dirty", () => {
        const h = historyMarkClean(historySave(historyFrom(base), edited));
        const { history, replaced } = historyReplaceCurrent(h, other);
        expect(replaced).toBe(true);
        expect(isClean(history)).toBe(false);
    });

    test("a replaced edit that returns to the saved baseline is clean", () => {
        const h = historySave(historyMarkClean(historyFrom(base)), edited);
        expect(isClean(historyReplaceCurrent(h, base).history)).toBe(true);
    });

    test("marking a snapshot that is no longer current leaves the current one dirty", () => {
        const saving = historySave(historyFrom(base), edited);
        let h = historySave(saving, other);
        h = historyMarkClean(h, historyHeadId(saving));
        expect(isClean(h)).toBe(false);
        expect(isClean(historyUndo(h)!)).toBe(true);
    });
});

describe("stored history", () => {
    test("round-trips undo, redo and the save point", () => {
        let h = historyMarkClean(historyFrom(rowSession(3, 3, { colorA: "#000000" })));
        h = historyUndo(historySave(h, rowSession(3, 3, { colorA: "#ffffff" })))!;
        const restored = reloaded(h)!;
        expect(isClean(restored)).toBe(true);
        expect(canRedo(restored)).toBe(true);
        expect(historyPeek(historyRedo(restored)!).colorA).toBe("#ffffff");
    });

    test("snapshots added after a reload never match an earlier save point", () => {
        let h = historyMarkClean(historySave(historyFrom(rowSession(3, 3)), rowSession(3, 3, { colorA: "#ffffff" })));
        h = historyReplaceCurrent(h, rowSession(3, 3)).history;
        h = historySave(reloaded(h)!, rowSession(3, 3, { colorA: "#ffffff" }));
        expect(isClean(h)).toBe(false);
    });

    test("a change stores only its new snapshots", () => {
        const before = historySave(historyFrom(rowSession(3, 3)), rowSession(3, 3, { colorA: "#111111" }));
        const after = historySave(before, rowSession(3, 3, { colorA: "#222222" }));
        const { meta, put } = historyChanges(before, after);
        expect(put).toEqual([after.snapshots[2]]);
        expect(meta.ids).toEqual(after.snapshots.map(snapshot => snapshot.id));
        expect(historyChanges(after, historyUndo(after)!).put).toEqual([]);
    });

    test("a restarted history stores its snapshot again", () => {
        const before = historySave(historyFrom(rowSession(3, 3)), rowSession(3, 3, { colorA: "#111111" }));
        const after = historyFrom(rowSession(4, 4));
        expect(historyChanges(before, after).put).toEqual([after.snapshots[0]]);
    });

    test("nothing stored → null", () => {
        expect(historyFromStored(undefined, [])).toBeNull();
    });

    test("a future history schema → null", () => {
        const { meta, put } = historyChanges(null, historyFrom(rowSession(3, 3)));
        expect(historyFromStored({ ...meta, version: 999 }, put)).toBeNull();
    });

    test("a history stored before recipe masks were packed → null", () => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 0, y: 0, v: 1 }, { x: 2, y: 0, v: 2 }]));
        const { meta, put } = structuredClone(historyChanges(null, historyFrom(rowSession(3, 3, { recipes: [recipe] }))));
        put[0].transforms.recipes = [{ ...put[0].transforms.recipes[0] as object, source: { ...recipe.source, mask: [1, 0, 1] } }];
        expect(historyFromStored({ ...meta, version: 9 }, put)).toBeNull();
    });

    test("a listed snapshot that is missing → null", () => {
        const h = historySave(historyFrom(rowSession(3, 3)), rowSession(3, 3, { colorA: "#111111" }));
        const { meta, put } = historyChanges(null, h);
        expect(historyFromStored(meta, put.slice(1))).toBeNull();
    });

    test("snapshot ids listed out of order → null", () => {
        const h = historySave(historyFrom(rowSession(3, 3)), rowSession(3, 3, { colorA: "#111111" }));
        const { meta, put } = historyChanges(null, h);
        expect(historyFromStored({ ...meta, ids: [...meta.ids].reverse() }, put)).toBeNull();
    });

    test("an unlisted stored snapshot is ignored", () => {
        const h = historyFrom(rowSession(3, 3));
        const { meta, put } = historyChanges(null, h);
        const unlisted = historyChanges(null, historyFrom(rowSession(5, 5))).put.map(snapshot => ({ ...snapshot, id: 7 }));
        expect(historyFromStored(meta, [...put, ...unlisted])!.snapshots).toHaveLength(1);
    });

    test("a snapshot beyond the pattern dimension limit → null", () => {
        expect(storedWith(historyFrom(rowSession(3, 3)), snapshot => {
            snapshot.document.state.canvasWidth = 32_768;
            snapshot.document.state.canvasHeight = 1;
        })).toBeNull();
    });

    test("a snapshot whose packed cells do not fit its pattern → null", () => {
        expect(storedWith(historyFrom(rowSession(3, 3)), snapshot => { snapshot.document.state.canvasWidth = 30; })).toBeNull();
    });

    test("a snapshot whose selection cells do not fit its size → null", () => {
        const h = historyFrom(rowSession(3, 3, { float: makeFloat([{ x: 0, y: 0, v: 1 }, { x: 1, y: 1, v: 2 }]) }));
        expect(storedWith(h, snapshot => { snapshot.selection.w = 30; })).toBeNull();
    });

    test.each([
        ["colorA", "red"],
        ["dangerColorOverride", "red"],
        ["dangerColorOverride", undefined],
        ["accentColorOverride", undefined],
    ])("a snapshot with %s = %s → null", (field, value) => {
        expect(storedWith(historyFrom(rowSession(3, 3)), snapshot => { snapshot.document[field] = value; })).toBeNull();
    });

    test("a snapshot with malformed mirrors → null", () => {
        expect(storedWith(historyFrom(rowSession(3, 3)), snapshot => { snapshot.transforms.mirrors = [{ id: 1 }]; })).toBeNull();
    });
});
