// @vitest-environment jsdom
// History (undo/redo) tests. localStorage-backed, so jsdom env.

import { describe, test, expect, beforeEach } from "vitest";
import {
    historySave, historyReset, historyEnsureInitialized,
    historyUndo, historyRedo, canUndo, canRedo, historyPeek,
} from "../src/history";
import { rowSession, filledPixels, makeFloat } from "./_helpers";
import { addAxis } from "@mosaic/logic/symmetry";

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

    test("repeat settings are part of history and survive undo", () => {
        const s = rowSession(3, 3);
        historyReset(s);
        historySave({
            ...s,
            repeat: { enabled: true, tileWidth: 3, tileHeight: 2, copiesX: 2, copiesY: 1 },
        });

        expect(canUndo()).toBe(true);
        expect(historyUndo()!.repeat).toEqual(s.repeat);
        expect(historyRedo()!.repeat).toEqual({
            enabled: true,
            tileWidth: 3,
            tileHeight: 2,
            copiesX: 2,
            copiesY: 1,
        });
    });

    test("invalid repeat settings in persisted history restore disabled defaults", () => {
        historyReset(rowSession(3, 3));
        const raw = JSON.parse(localStorage.getItem("mosaic-history-v4")!);
        raw.snapshots[0].repeat = {
            enabled: true, tileWidth: 0, tileHeight: 1, copiesX: 1, copiesY: 1,
        };
        localStorage.setItem("mosaic-history-v4", JSON.stringify(raw));

        expect(historyPeek()!.repeat).toEqual({
            enabled: false,
            tileWidth: 1,
            tileHeight: 1,
            copiesX: 1,
            copiesY: 1,
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
