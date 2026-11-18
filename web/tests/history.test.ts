// @vitest-environment jsdom
// History (undo/redo) tests. Load / write are localStorage-backed, so jsdom env.

import { describe, test, expect, beforeEach, vi } from "vitest";
import {
    historyFrom, historySave, historyReplaceCurrent, loadHistory, writeHistory,
    historyUndo, historyRedo, canUndo, canRedo, historyPeek,
} from "../src/history";
import { rowSession, filledPixels, makeFloat } from "./_helpers";
import { addMirror } from "@mosaic/logic/symmetry";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";
import { encodeMcw } from "@mosaic/logic/mcw";

beforeEach(() => { localStorage.clear(); });

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

    test("legacy missing overrides remain unknown while explicit null remains a default", () => {
        writeHistory(historyFrom(rowSession(3, 3)));
        const raw = JSON.parse(localStorage.getItem("mosaic-history")!);
        raw.version = 5;
        delete raw.snapshots[0].document.dangerColorOverride;
        delete raw.snapshots[0].document.accentColorOverride;
        localStorage.setItem("mosaic-history", JSON.stringify(raw));
        let h = historySave(loadHistory()!, rowSession(3, 3, { dangerColorOverride: "#123456", accentColorOverride: null }));
        h = historyUndo(h)!;
        expect(h).not.toBeNull();
        expect(historyPeek(h).dangerColorOverride).toBeUndefined();
        expect(historyPeek(h).accentColorOverride).toBeUndefined();
        h = historyRedo(h)!;
        expect(historyPeek(h)).toMatchObject({ dangerColorOverride: "#123456", accentColorOverride: null });
        expect(JSON.parse(localStorage.getItem("mosaic-history")!).version).toBe(8);
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

    test("invalid persisted recipes are discarded", () => {
        writeHistory(historyFrom(rowSession(3, 3)));
        const raw = JSON.parse(localStorage.getItem("mosaic-history")!);
        raw.snapshots[0].transforms.recipes = [{ id: "bad" }];
        raw.version = 7;
        for (const recipe of raw.snapshots[0].transforms.recipes ?? []) {
            delete recipe.mirrorCentreX; delete recipe.mirrorCentreY; delete recipe.mirrorTypes;
        }
        localStorage.setItem("mosaic-history", JSON.stringify(raw));

        const h = loadHistory()!;
        expect(historyPeek(h).recipes).toHaveLength(1);
        expect(historyPeek(h).recipes[0].source.mask).toHaveLength(0);
    });

    test("history defaults optional v3 recipe extensions", () => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 1 }]));
        recipe.columnSpacing = 2;
        recipe.rowSpacing = 3;
        writeHistory(historyFrom(rowSession(3, 3, { recipes: [recipe] })));
        const raw = JSON.parse(localStorage.getItem("mosaic-history")!);
        const stored = raw.snapshots[0].transforms.recipes[0];
        delete stored.mode;
        delete stored.columnSpacingAlternate;
        delete stored.rowSpacingAlternate;
        delete stored.rotationCentreX;
        delete stored.rotationCentreY;
        delete stored.rotationTurns;
        raw.version = 7;
        for (const recipe of raw.snapshots[0].transforms.recipes ?? []) {
            delete recipe.mirrorCentreX; delete recipe.mirrorCentreY; delete recipe.mirrorTypes;
        }
        localStorage.setItem("mosaic-history", JSON.stringify(raw));

        expect(historyPeek(loadHistory()!).recipes[0]).toMatchObject({
            mode: "grid",
            columnSpacingAlternate: 2,
            rowSpacingAlternate: 3,
            rotationCentreX: 1,
            rotationCentreY: 1,
            rotationTurns: [],
        });
    });

    test("history retains alternate gaps in current records", () => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 1 }]));
        recipe.columnSpacingAlternate = 7;
        recipe.rowSpacingAlternate = 8;
        writeHistory(historyFrom(rowSession(3, 3, { recipes: [recipe] })));

        expect(historyPeek(loadHistory()!).recipes[0]).toMatchObject({
            columnSpacingAlternate: 7,
            rowSpacingAlternate: 8,
        });
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

describe("loadHistory / writeHistory", () => {
    test("null when nothing is stored", () => {
        expect(loadHistory()).toBeNull();
    });

    test("null when the stored history has no snapshots", () => {
        localStorage.setItem("mosaic-history", JSON.stringify({ version: 8, snapshots: [], index: -1 }));
        expect(loadHistory()).toBeNull();
    });

    test("round-trips the written history", () => {
        const s = rowSession(3, 3, { colorA: "#000000" });
        writeHistory(historySave(historyFrom(s), rowSession(3, 3, { colorA: "#ffffff" })));
        const h = loadHistory()!;
        // Still able to undo the colour change we pushed.
        expect(canUndo(h)).toBe(true);
        expect(historyPeek(h).colorA).toBe("#ffffff");
    });
    test("over quota, drops the oldest snapshots and returns what was stored", () => {
        let h = historyFrom(rowSession(3, 3, { colorA: "#000001" }));
        h = historySave(h, rowSession(3, 3, { colorA: "#000002" }));
        h = historySave(h, rowSession(3, 3, { colorA: "#000003" }));
        const originalSetItem = Storage.prototype.setItem;
        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
            if (key === "mosaic-history" && JSON.parse(value).snapshots.length > 1) throw new DOMException("full", "QuotaExceededError");
            return originalSetItem.call(this, key, value);
        });

        try {
            const stored = writeHistory(h);
            expect(stored.snapshots).toHaveLength(1);
            expect(stored.index).toBe(0);
            expect(historyPeek(stored).colorA).toBe("#000003");
            expect(loadHistory()).toMatchObject(stored);
        } finally {
            setItem.mockRestore();
        }
    });
});
