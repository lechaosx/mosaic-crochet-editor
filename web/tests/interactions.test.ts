// @vitest-environment jsdom
// Cross-feature state-level interactions. Each test models a combination
// of operations that's "bug-class we already hit during iteration" —
// landing a fix without a regression test invites the bug back.

import { describe, test, expect, beforeEach } from "vitest";
import { Store } from "../src/store";
import {
    applySelectionMod, anchorFloat, selectAll,
} from "../src/selection";
import { copyFloat, cutFloat, pasteClipboard } from "../src/clipboard";
import { historyReset, historySave, historyUndo, canUndo, historyPeek } from "../src/history";
import { filledPixels, makeFloat, maskOf, rowSession } from "./_helpers";

function storeOf(opts: Parameters<typeof rowSession>[2] = {}): Store {
    return new Store(rowSession(3, 3, opts));
}

beforeEach(() => { localStorage.clear(); });

describe("modify selection after a Move-drag (dx/dy != 0)", () => {
    test("add at the displaced float: lifts new cells without anchoring", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 1, 0),   // float lifted at (0,0), shown at (1,0)
        });
        // Add cell (2, 0) in canvas coords. Source = (2 - 1, 0 - 0) = (1, 0).
        applySelectionMod(s, maskOf(3, 3, [[2, 0]]), "add");
        // Existing source position (0, 0) untouched in mask.
        expect(s.state.float!.mask[0]).toBe(1);
        // New source position (1, 0) added.
        expect(s.state.float!.mask[1]).toBe(1);
        // Offset preserved.
        expect(s.state.float!.dx).toBe(1);
        expect(s.state.float!.dy).toBe(0);
    });

    test("remove at the displaced float: stamps at current canvas position", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 1, 0),
        });
        // Remove canvas cell (1, 0) — that's where the float is shown.
        applySelectionMod(s, maskOf(3, 3, [[1, 0]]), "remove");
        // Cell (1, 0) in canvas now has the float's stamped value (2).
        expect(s.state.pixels[1]).toBe(2);
        // Float emptied → null.
        expect(s.state.float).toBeNull();
    });
});

describe("paste over an existing float anchors it first", () => {
    test("clipboard from one float; paste while another is active anchors and stacks", () => {
        // Source store: lift, copy. Clipboard now has the lifted content.
        const src = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 2, y: 2, v: 2 }]),
        });
        copyFloat(src);   // stamps + yanks

        // Destination store: a *different* float is active.
        const dest = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
        });
        pasteClipboard(dest);

        // The prior float at (0, 0) anchored → canvas[0,0] should now be 2.
        expect(dest.state.pixels[0]).toBe(2);
        // The new float is the paste at (2, 2).
        expect(dest.state.float!.mask[2 * 3 + 2]).toBe(1);
        expect(dest.state.float!.mask[0]).toBe(0);
    });
});

describe("Cut → paste round-trips at the same canvas location", () => {
    test("cut clears, paste re-lifts at origin", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 2),
            float:  makeFloat(3, 3, [{ x: 1, y: 1, v: 2 }]),
        });
        cutFloat(s);
        // Row 1 baseline = B = 2; canvas[1,1] cleared to baseline (no-op
        // visually since it was already 2, but the float dropped).
        expect(s.state.float).toBeNull();

        pasteClipboard(s);
        // Float re-created at the original position (1, 1).
        expect(s.state.float!.mask[1 * 3 + 1]).toBe(1);
        expect(s.state.float!.pixels[1 * 3 + 1]).toBe(2);
    });
});

describe("Wand-add then wand-remove chains the selection", () => {
    // The wand BFS is tested elsewhere; here we just verify the chain of
    // applySelectionMod calls leaves the right mask shape.
    test("two adds and a remove → second add minus the remove", () => {
        const s = storeOf({ pixels: filledPixels(3, 3, 1) });
        // First add: pick cells (0, 0) and (0, 1).
        applySelectionMod(s, maskOf(3, 3, [[0, 0], [0, 1]]), "add");
        // Second add: extend with (1, 0).
        applySelectionMod(s, maskOf(3, 3, [[1, 0]]), "add");
        expect(s.state.float!.mask[0]).toBe(1);
        expect(s.state.float!.mask[3]).toBe(1);   // (0, 1)
        expect(s.state.float!.mask[1]).toBe(1);   // (1, 0)
        // Remove (0, 0).
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "remove");
        expect(s.state.float!.mask[0]).toBe(0);
        expect(s.state.float!.mask[3]).toBe(1);
        expect(s.state.float!.mask[1]).toBe(1);
    });
});

describe("History around float modifications", () => {
    test("anchor float pushes a snapshot that undo restores", () => {
        const s = storeOf({ pixels: filledPixels(3, 3, 1) });
        historyReset(s.state);
        // Lift via select-all.
        selectAll(s);
        historySave(s.state);
        anchorFloat(s);
        historySave(s.state);
        // Undo: should pop the anchor → float comes back.
        const r = historyUndo();
        expect(r).not.toBeNull();
        expect(r!.float).not.toBeNull();
    });

    test("selectAll then deselect is canvas-identity", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 1),
        });
        const before = s.state.pixels.slice();
        selectAll(s);
        anchorFloat(s);
        // Canvas content unchanged (lift then anchor at offset 0).
        for (let i = 0; i < before.length; i++) {
            expect(s.state.pixels[i]).toBe(before[i]);
        }
        expect(s.state.float).toBeNull();
    });
});

describe("Float survives save/export bake (the SessionState snapshot is throwaway)", () => {
    // The actual `onSave`/`onExport` use the live store; what we verify
    // here is the helper that builds the bake snapshot doesn't mutate
    // the input state — i.e. `anchorIntoCanvas(state)` is read-only.
    test("anchorIntoCanvas returns a new pixels buffer and float=null without mutating input", async () => {
        const { anchorIntoCanvas } = await import("../src/selection");
        const s = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
        });
        const originalPixels = s.pixels;
        const originalFloat  = s.float;
        const baked = anchorIntoCanvas(s);
        expect(s.pixels).toBe(originalPixels);
        expect(s.float).toBe(originalFloat);
        expect(baked.float).toBeNull();
        expect(baked.pixels).not.toBe(originalPixels);
        expect(baked.pixels[0]).toBe(2);   // stamped
    });
});

describe("Canvas resize with active float (bake happens in onEditChange)", () => {
    // We can't trigger `onEditChange` from a Vitest unit test (it reads
    // DOM inputs). What we *can* test is that `visiblePixels` correctly
    // bakes the float across a fake "head" snapshot — which is the
    // single failure mode that motivated the bake step.
    test("visiblePixels with a head-snapshot float bakes content into the source pixels", async () => {
        const { visiblePixels } = await import("../src/store");
        const head = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 1, 0),
        });
        // The resize path passes a constructed state with head fields:
        const baked = visiblePixels(head);
        // Source cell (0, 0) was canvas 1; stamp at offset → canvas[1, 0] = 2.
        expect(baked[1]).toBe(2);
        // Cell (0, 0) untouched in pixels (still 1).
        expect(baked[0]).toBe(1);
    });
});
