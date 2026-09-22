// @vitest-environment jsdom
// History (undo/redo) tests. localStorage-backed, so jsdom env.

import { describe, test, expect, beforeEach } from "vitest";
import {
    historySave, historyReplaceCurrent, historyReset, historyEnsureInitialized,
    historyUndo, historyRedo, canUndo, canRedo, historyPeek,
} from "../src/history";
import { rowSession, filledPixels, makeFloat } from "./_helpers";
import { addAxis } from "@mosaic/logic/symmetry";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";
import { encodeMcw } from "@mosaic/logic/mcw";

beforeEach(() => { localStorage.clear(); });

describe("historySave / historyReset", () => {
    test("reset seeds a single snapshot at index 0", () => {
        const s = rowSession(3, 3);
        historyReset(s);
        expect(canUndo()).toBe(false);
        expect(canRedo()).toBe(false);
        expect(historyPeek()).not.toBeNull();
    });

    test("save pushes a new snapshot, enabling undo", () => {
        historyReset(rowSession(3, 3));
        historySave(rowSession(3, 3, { pixels: filledPixels(3, 3, 2) }));
        expect(canUndo()).toBe(true);
    });

    test("save dedupes against the head (no-op state push doesn't grow history)", () => {
        const s = rowSession(3, 3);
        historyReset(s);
        historySave(s);   // identical state
        expect(canUndo()).toBe(false);
    });

    test("replace current updates an edit's redo state without losing its undo baseline", () => {
        const baseline = rowSession(3, 3);
        historyReset(baseline);
        historySave(rowSession(4, 3));

        historyReplaceCurrent(rowSession(4, 5));

        expect(historyUndo()!.pattern).toEqual(baseline.pattern);
        expect(historyRedo()!.pattern.canvasWidth).toBe(4);
        expect(historyPeek()!.pattern.canvasHeight).toBe(5);
    });

    test("replace current removes a coalesced edit that returned to its baseline", () => {
        const baseline = rowSession(3, 3);
        historyReset(baseline);
        historySave(rowSession(4, 3));

        expect(historyReplaceCurrent(baseline)).toBe(false);

        expect(canUndo()).toBe(false);
        expect(historyPeek()!.pattern).toEqual(baseline.pattern);
    });

    test("float changes are part of the dedupe key — pushing a float pushes a snapshot", () => {
        const s = rowSession(3, 3);
        historyReset(s);
        historySave({ ...s, float: makeFloat([{ x: 0, y: 0, v: 1 }]) });
        expect(canUndo()).toBe(true);
    });

    test("axis changes are part of the dedupe key — adding an axis pushes a snapshot", () => {
        const s = rowSession(3, 3);
        historyReset(s);
        historySave({ ...s, axes: addAxis([], "V", 3, 3) });
        expect(canUndo()).toBe(true);
    });

    test("saved recipes are part of history and survive undo", () => {
        const s = rowSession(3, 3);
        const float = makeFloat([{ x: 0, y: 0, v: 1 }]);
        const recipe = gridRecipeFromFloat(float);
        historyReset(s);
        historySave({
            ...s,
            float, recipes: [recipe], activeRecipeId: recipe.id,
        });

        expect(canUndo()).toBe(true);
        expect(historyUndo()!.recipes).toEqual([]);
        expect(historyRedo()!.recipes).toEqual([recipe]);
        expect(historyPeek()!.activeRecipeId).toBe(recipe.id);
    });

    test("history clears an active recipe whose restored float does not match its source", () => {
        const source = makeFloat([{ x: 0, y: 0, v: 1 }]);
        const recipe = gridRecipeFromFloat(source);
        historyReset(rowSession(3, 3, {
            recipes: [recipe],
            activeRecipeId: recipe.id,
            float: makeFloat([{ x: 1, y: 0, v: 1 }]),
        }));

        expect(historyPeek()!.activeRecipeId).toBeNull();
    });

    test("invalid persisted recipes are discarded", () => {
        historyReset(rowSession(3, 3));
        const raw = JSON.parse(localStorage.getItem("mosaic-history")!);
        raw.snapshots[0].transforms.recipes = [{ id: "bad" }];
        localStorage.setItem("mosaic-history", JSON.stringify(raw));

        expect(historyPeek()!.recipes).toEqual([]);
    });

    test("history defaults optional v3 recipe extensions", () => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 1 }]));
        recipe.columnSpacing = 2;
        recipe.rowSpacing = 3;
        historyReset(rowSession(3, 3, { recipes: [recipe] }));
        const raw = JSON.parse(localStorage.getItem("mosaic-history")!);
        const stored = raw.snapshots[0].transforms.recipes[0];
        delete stored.mode;
        delete stored.columnSpacingAlternate;
        delete stored.rowSpacingAlternate;
        delete stored.rotationCentreX;
        delete stored.rotationCentreY;
        delete stored.rotationTurns;
        localStorage.setItem("mosaic-history", JSON.stringify(raw));

        expect(historyPeek()!.recipes[0]).toMatchObject({
            mode: "grid",
            columnSpacingAlternate: 2,
            rowSpacingAlternate: 3,
            rotationCentreX: 1,
            rotationCentreY: 1,
            rotationTurns: [],
        });
    });

    test("axis position survives undo: add V, drag to x=0, undo restores canonical", () => {
        const s = rowSession(3, 3);
        historyReset(s);
        // Snapshot 1: V added at canonical x=1.
        const v1 = addAxis([], "V", 3, 3);
        historySave({ ...s, axes: v1 });
        // Snapshot 2: V moved to x=0 (same id, new position).
        const v2 = v1.map(a => a.kind === "V" ? { ...a, x: 0 } : a);
        historySave({ ...s, axes: v2 });
        // Undo back to V@x=1.
        const r = historyUndo();
        expect(r).not.toBeNull();
        const v = r!.axes.find(a => a.kind === "V")!;
        expect(v.kind === "V" && v.x === 1).toBe(true);
    });

    test("undo drops stale axes but retains valid disabled axes", () => {
        const valid = { id: "valid", kind: "V" as const, active: false, x: 1 };
        const stale = { id: "stale", kind: "H" as const, active: true, y: 0 };
        const baseline = rowSession(3, 3, { axes: [valid, stale] });
        historyReset(baseline);
        historySave({ ...baseline, colorA: "#abcdef" });

        const restored = historyUndo()!;
        expect(restored.axes).toEqual([valid]);
        expect(() => encodeMcw(restored)).not.toThrow();
    });
});

describe("historyUndo / Redo navigation", () => {
    test("undo + redo restore the same state", () => {
        historyReset(rowSession(3, 3));
        historySave(rowSession(3, 3, { pixels: filledPixels(3, 3, 2) }));
        const undone = historyUndo();
        expect(undone).not.toBeNull();
        expect(canUndo()).toBe(false);
        expect(canRedo()).toBe(true);
        const redone = historyRedo();
        expect(redone).not.toBeNull();
        expect(canRedo()).toBe(false);
    });

    test("save after undo truncates the redo branch", () => {
        historyReset(rowSession(3, 3));
        historySave(rowSession(3, 3, { pixels: filledPixels(3, 3, 2) }));   // S1
        historyUndo();
        historySave(rowSession(3, 3, { colorA: "#abc123" }));                // S1'
        expect(canRedo()).toBe(false);
    });

    test("undo at the bottom returns null", () => {
        historyReset(rowSession(3, 3));
        expect(historyUndo()).toBeNull();
    });

    test("redo at the top returns null", () => {
        historyReset(rowSession(3, 3));
        expect(historyRedo()).toBeNull();
    });
});

describe("historyPeek", () => {
    test("returns current head without moving the index", () => {
        const s = rowSession(3, 3, { colorA: "#aabbcc" });
        historyReset(s);
        const peeked = historyPeek();
        expect(peeked!.colorA).toBe("#aabbcc");
        // Index didn't move:
        expect(canUndo()).toBe(false);
    });

    test("null when history is empty", () => {
        expect(historyPeek()).toBeNull();
    });
});

describe("historyEnsureInitialized", () => {
    test("seeds history if empty", () => {
        historyEnsureInitialized(rowSession(3, 3));
        expect(historyPeek()).not.toBeNull();
    });

    test("leaves existing history alone", () => {
        const s = rowSession(3, 3, { colorA: "#000000" });
        historyReset(s);
        historySave(rowSession(3, 3, { colorA: "#ffffff" }));
        historyEnsureInitialized(rowSession(3, 3));
        // Still able to undo the colour change we pushed.
        expect(canUndo()).toBe(true);
    });
});
