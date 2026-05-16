// Clipboard tests. The clipboard is module-level state, so tests run in
// declared order and don't fork — but `paste` after a fresh `copy`/`cut`
// is the only API that depends on prior state, and we sequence it
// explicitly.

import { describe, test, expect } from "vitest";
import { Store } from "../src/store";
import { copyFloat, cutFloat, pasteClipboard, hasClipboard } from "../src/clipboard";
import { filledPixels, makeFloat, rowSession } from "./_helpers";

function storeOf(opts: Parameters<typeof rowSession>[2] = {}): Store {
    return new Store(rowSession(3, 3, opts));
}

describe("copyFloat", () => {
    test("no float: no-op (no clipboard, no commit)", () => {
        const s = storeOf();
        const pixelsBefore = s.state.pixels;
        copyFloat(s);
        expect(s.state.pixels).toBe(pixelsBefore);
    });

    test("with float: stamps into canvas, leaves float alive, sets clipboard", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
        });
        copyFloat(s);
        expect(s.state.pixels[0]).toBe(2);          // stamped
        expect(s.state.float).not.toBeNull();        // float kept
        expect(hasClipboard()).toBe(true);
    });
});

describe("cutFloat", () => {
    test("with float: clears canvas under the float, drops the float", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 2),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
        });
        cutFloat(s);
        // Row 0 baseline = A = 1, so cleared cell = 1.
        expect(s.state.pixels[0]).toBe(1);
        expect(s.state.float).toBeNull();
    });

    test("no float: no-op", () => {
        const s = storeOf();
        cutFloat(s);
        expect(s.state.float).toBeNull();
    });
});

describe("pasteClipboard", () => {
    test("pastes back at the original canvas position as a non-destructive float", () => {
        // First populate the clipboard via copy.
        const src = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 1, y: 1, v: 2 }]),
        });
        copyFloat(src);   // clipboard captures the v=2 cell at (1,1)

        // Fresh store, paste.
        const dest = storeOf({ pixels: filledPixels(3, 3, 1) });
        const ok = pasteClipboard(dest);
        expect(ok).toBe(true);
        expect(dest.state.float!.mask[1 * 3 + 1]).toBe(1);
        expect(dest.state.float!.pixels[1 * 3 + 1]).toBe(2);
        // Canvas at (1,1) stays untouched (paste is uncut).
        expect(dest.state.pixels[1 * 3 + 1]).toBe(1);
    });

    test("paste with an active float anchors the prior float first", () => {
        const src = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 1, y: 1, v: 2 }]),
        });
        copyFloat(src);

        const dest = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
        });
        pasteClipboard(dest);
        // Prior float anchored at (0,0): canvas has 2 there now.
        expect(dest.state.pixels[0]).toBe(2);
        // New float is the paste at (1,1).
        expect(dest.state.float!.mask[1 * 3 + 1]).toBe(1);
        expect(dest.state.float!.mask[0]).toBe(0);
    });
});
