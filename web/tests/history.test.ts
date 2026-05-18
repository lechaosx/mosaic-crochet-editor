// @vitest-environment jsdom
// History (undo/redo) tests. localStorage-backed, so jsdom env.

import { describe, test, expect, beforeEach } from "vitest";
import {
    historySave, historyReset, historyEnsureInitialized,
    historyUndo, historyRedo, canUndo, canRedo, historyPeek,
} from "../src/history";
import { rowSession, filledPixels, makeFloat } from "./_helpers";

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

    test("axis changes are part of the dedupe key — toggling activates a snapshot", () => {
        const s = rowSession(3, 3);
        historyReset(s);
        // Toggle V on by mutating the V preset's `active`.
        const flipped = s.axes.map(a =>
            a.kind === "V" ? { ...a, active: true } : a
        );
        historySave({ ...s, axes: flipped });
        expect(canUndo()).toBe(true);
    });

    test("axis position survives undo: drag V to x=2, snapshot, undo restores", () => {
        const s = rowSession(3, 3);
        historyReset(s);
        // Snapshot with V active at canonical x=1.
        const v1 = s.axes.map(a =>
            a.kind === "V" ? { ...a, active: true } : a
        );
        historySave({ ...s, axes: v1 });
        // Now snapshot with V moved to x=0 (still active).
        const v2 = s.axes.map(a =>
            a.kind === "V" ? { ...a, active: true, x: 0 } : a
        );
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
