// Cross-feature state-level interactions — pure logic only.
// Tests that require history/localStorage live in web/tests/interactions.test.ts.
import { describe, test, expect } from "vitest";
import { Store } from "../src/store";
import { visiblePixels } from "../src/store";
import { applySelectionMod, anchorFloat, selectAll, anchorIntoCanvas } from "../src/selection";
import { copyFloat, cutFloat, pasteClipboard } from "../src/clipboard";
import { filledPixels, makeFloat, maskOf, rowSession } from "./_helpers";

function storeOf(opts: Parameters<typeof rowSession>[2] = {}): Store {
    return new Store(rowSession(3, 3, opts));
}

describe("modify selection after a Move-drag (dx/dy != 0)", () => {
    test("add at the displaced float: lifts new cells without anchoring", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 1, 0),
        });
        applySelectionMod(s, maskOf(3, 3, [[2, 0]]), "add");
        expect(s.state.float!.mask[0]).toBe(1);
        expect(s.state.float!.mask[1]).toBe(1);
        expect(s.state.float!.dx).toBe(1);
        expect(s.state.float!.dy).toBe(0);
    });

    test("remove at the displaced float: stamps at current canvas position", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 1, 0),
        });
        applySelectionMod(s, maskOf(3, 3, [[1, 0]]), "remove");
        expect(s.state.pixels[1]).toBe(2);
        expect(s.state.float).toBeNull();
    });
});

describe("paste over an existing float anchors it first", () => {
    test("clipboard from one float; paste while another is active anchors and stacks", () => {
        const src = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 2, y: 2, v: 2 }]),
        });
        copyFloat(src);

        const dest = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
        });
        pasteClipboard(dest);

        expect(dest.state.pixels[0]).toBe(2);
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
        expect(s.state.float).toBeNull();

        pasteClipboard(s);
        expect(s.state.float!.mask[1 * 3 + 1]).toBe(1);
        expect(s.state.float!.pixels[1 * 3 + 1]).toBe(2);
    });
});

describe("Wand-add then wand-remove chains the selection", () => {
    test("two adds and a remove → second add minus the remove", () => {
        const s = storeOf({ pixels: filledPixels(3, 3, 1) });
        applySelectionMod(s, maskOf(3, 3, [[0, 0], [0, 1]]), "add");
        applySelectionMod(s, maskOf(3, 3, [[1, 0]]), "add");
        expect(s.state.float!.mask[0]).toBe(1);
        expect(s.state.float!.mask[3]).toBe(1);
        expect(s.state.float!.mask[1]).toBe(1);
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "remove");
        expect(s.state.float!.mask[0]).toBe(0);
        expect(s.state.float!.mask[3]).toBe(1);
        expect(s.state.float!.mask[1]).toBe(1);
    });
});

describe("Float survives save/export bake (anchorIntoCanvas is read-only)", () => {
    test("returns new pixels buffer and float=null without mutating input", () => {
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
        expect(baked.pixels[0]).toBe(2);
    });
});

describe("Canvas resize with active float", () => {
    test("visiblePixels bakes float content at the correct offset", () => {
        const head = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 1, 0),
        });
        const baked = visiblePixels(head);
        expect(baked[1]).toBe(2);
        expect(baked[0]).toBe(1);
    });
});

describe("selectAll then anchorFloat is canvas-identity", () => {
    test("lift then anchor leaves pixels unchanged", () => {
        const s = storeOf({ pixels: filledPixels(3, 3, 1) });
        const before = s.state.pixels.slice();
        selectAll(s);
        anchorFloat(s);
        for (let i = 0; i < before.length; i++) {
            expect(s.state.pixels[i]).toBe(before[i]);
        }
        expect(s.state.float).toBeNull();
    });
});
