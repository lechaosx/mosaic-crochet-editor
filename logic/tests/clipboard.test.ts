// Clipboard tests. The clipboard is module-level state, so tests run in
// declared order and don't fork — but `paste` after a fresh `copy`/`cut`
// is the only API that depends on prior state, and we sequence it
// explicitly.

import { describe, test, expect } from "vitest";
import { Store } from "../src/store";
import { copyFloat, cutFloat, pasteClipboard, hasClipboard } from "../src/clipboard";
import { filledPixels, makeFloat, rowSession } from "./_helpers";
import type { Float } from "../src/types";

function storeOf(opts: Parameters<typeof rowSession>[2] = {}): Store {
    return new Store(rowSession(3, 3, opts));
}

// Helper: returns true if canvas cell (cx, cy) is present in the float.
function inFloat(f: Float, cx: number, cy: number): boolean {
    const lx = cx - f.x, ly = cy - f.y;
    if (lx < 0 || lx >= f.w || ly < 0 || ly >= f.h) return false;
    return f.pixels[ly * f.w + lx] !== 0;
}

// Helper: value at canvas cell (cx, cy) in the float (0 if absent).
function floatAt(f: Float, cx: number, cy: number): number {
    const lx = cx - f.x, ly = cy - f.y;
    if (lx < 0 || lx >= f.w || ly < 0 || ly >= f.h) return 0;
    return f.pixels[ly * f.w + lx];
}

describe("copyFloat", () => {
    test("no float: no-op (no clipboard, no commit)", () => {
        const s = storeOf();
        const pixelsBefore = s.state.pixels;
        copyFloat(s);
        expect(s.state.pixels).toBe(pixelsBefore);
    });

    test("with float: captures clipboard, leaves canvas and float unchanged", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat([{ x: 0, y: 0, v: 2 }]),
        });
        const pixelsBefore = s.state.pixels;
        const floatBefore  = s.state.float;
        copyFloat(s);
        expect(s.state.pixels).toBe(pixelsBefore);  // canvas untouched
        expect(s.state.float).toBe(floatBefore);    // float untouched
        expect(hasClipboard()).toBe(true);
    });
});

describe("cutFloat", () => {
    test("with float: clears canvas under the float, drops the float", () => {
        const s = storeOf({
            pixels: filledPixels(3, 3, 2),
            float:  makeFloat([{ x: 0, y: 0, v: 2 }]),
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

describe("yankFloat bbox correctness (via copy + paste round-trip)", () => {
    test("multi-cell float spread across the canvas round-trips at the same cells", () => {
        // Kills bbox-computation mutations (minX/maxX/minY/maxY guards
        // and Math.ceil sizes) — they only matter when cells span more
        // than a 1×1 bbox, and the surviving cells must include both
        // extremes of x and y. Cells: (1,0) top-right-ish, (0,1) left,
        // (2,2) bottom-right.
        const W = 4, H = 4;
        const src = new Store(rowSession(W, H, {
            pixels: filledPixels(W, H, 1),
            float:  makeFloat([
                { x: 1, y: 0, v: 2 },
                { x: 0, y: 1, v: 2 },
                { x: 2, y: 2, v: 2 },
            ]),
        }));
        copyFloat(src);

        const dest = new Store(rowSession(W, H, { pixels: filledPixels(W, H, 1) }));
        pasteClipboard(dest);
        const f = dest.state.float!;
        // Every original cell appears in the paste-float at its canvas position.
        expect(inFloat(f, 1, 0)).toBe(true);  expect(floatAt(f, 1, 0)).toBe(2);
        expect(inFloat(f, 0, 1)).toBe(true);  expect(floatAt(f, 0, 1)).toBe(2);
        expect(inFloat(f, 2, 2)).toBe(true);  expect(floatAt(f, 2, 2)).toBe(2);
        // No other cells.
        let total = 0;
        for (let i = 0; i < f.pixels.length; i++) if (f.pixels[i]) total++;
        expect(total).toBe(3);
    });

    test("offset float copies into clipboard at its visible (canvas) position", () => {
        // Float at absolute (2,1). Clipboard origin must be (2,1) so paste
        // re-lands at (2,1).
        const W = 4, H = 4;
        const src = new Store(rowSession(W, H, {
            pixels: filledPixels(W, H, 1),
            float:  makeFloat([{ x: 2, y: 1, v: 2 }]),
        }));
        copyFloat(src);

        const dest = new Store(rowSession(W, H, { pixels: filledPixels(W, H, 1) }));
        pasteClipboard(dest);
        expect(inFloat(dest.state.float!, 2, 1)).toBe(true);
        expect(inFloat(dest.state.float!, 0, 0)).toBe(false);
    });

    test("empty float (all pixels zero, defensive) doesn't trigger a commit", () => {
        // Kills `if (maxX < 0) return false` → `if (false)` (the dead-
        // selection guard). With the guard skipped, yankFloat would clone a
        // zero-pixel float and copyFloat would commit it unnecessarily.
        const W = 3, H = 3;
        // Construct a Float directly with all-zero pixels (no cells present).
        const emptyFloat: Float = { x: 0, y: 0, w: 1, h: 1, pixels: new Uint8Array(1) };
        const src = new Store(rowSession(W, H, {
            pixels: filledPixels(W, H, 1),
            float:  emptyFloat,
        }));
        const pixelsBefore = src.state.pixels;
        // copyFloat with an all-zero float must early-return cleanly, not
        // throw and not stamp.
        expect(() => copyFloat(src)).not.toThrow();
        expect(src.state.pixels).toBe(pixelsBefore);
    });
});

describe("cutFloat with offset", () => {
    test("clears canvas at the float's visible position, not elsewhere", () => {
        // Float source at absolute (1,0) — visible at that canvas position.
        const W = 3, H = 3;
        const s = new Store(rowSession(W, H, {
            pixels: filledPixels(W, H, 2),
            float:  makeFloat([{ x: 1, y: 0, v: 2 }]),
        }));
        cutFloat(s);
        // Visible position (1,0) cleared to baseline (row 0 = A = 1).
        expect(s.state.pixels[1]).toBe(1);
        // Position (0,0) was never in the float — it had v=2.
        expect(s.state.pixels[0]).toBe(2);
        expect(s.state.float).toBeNull();
    });
});

describe("pasteClipboard", () => {
    test("pastes back at the original canvas position as a non-destructive float", () => {
        // First populate the clipboard via copy.
        const src = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        copyFloat(src);   // clipboard captures the v=2 cell at (1,1)

        // Fresh store, paste.
        const dest = storeOf({ pixels: filledPixels(3, 3, 1) });
        const ok = pasteClipboard(dest);
        expect(ok).toBe(true);
        expect(inFloat(dest.state.float!, 1, 1)).toBe(true);
        expect(floatAt(dest.state.float!, 1, 1)).toBe(2);
        // Canvas at (1,1) stays untouched (paste is uncut).
        expect(dest.state.pixels[1 * 3 + 1]).toBe(1);
    });

    test("paste with an active float anchors the prior float first", () => {
        const src = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        copyFloat(src);

        const dest = storeOf({
            pixels: filledPixels(3, 3, 1),
            float:  makeFloat([{ x: 0, y: 0, v: 2 }]),
        });
        pasteClipboard(dest);
        // Prior float anchored at (0,0): canvas has 2 there now.
        expect(dest.state.pixels[0]).toBe(2);
        // New float is the paste at (1,1).
        expect(inFloat(dest.state.float!, 1, 1)).toBe(true);
        expect(inFloat(dest.state.float!, 0, 0)).toBe(false);
    });

    test("paste whose content lands entirely outside the canvas returns false", () => {
        // Kills `let any = false` → `true` (would commit an empty paste-
        // float anyway) and `if (!any) return false` → `if (false)`
        // (would commit despite no cells landing).
        // Copy from a 9×9 canvas with a cell at (8, 8); paste into a 3×3
        // canvas where originX/Y = 8 → entirely outside.
        const src = new Store(rowSession(9, 9, {
            pixels: filledPixels(9, 9, 1),
            float:  makeFloat([{ x: 8, y: 8, v: 2 }]),
        }));
        copyFloat(src);

        const dest = new Store(rowSession(3, 3, { pixels: filledPixels(3, 3, 1) }));
        expect(pasteClipboard(dest)).toBe(false);
        expect(dest.state.float).toBeNull();
    });

    test("paste skips hole cells underneath (round-pattern canvas)", () => {
        // Kills `if (pixels[..] === 0) continue` → `if (false)`: the
        // hole-drop guard. Construct a round canvas with known holes,
        // then paste a clipboard that overlaps them.
        const src = new Store(rowSession(8, 8, {
            pixels: filledPixels(8, 8, 1),
            // Cover most of the canvas so SOME cells land on round-pattern
            // holes when pasted into the round dest.
            float:  makeFloat([
                { x: 0, y: 0, v: 2 }, { x: 1, y: 0, v: 2 },
                { x: 0, y: 1, v: 2 }, { x: 7, y: 7, v: 2 },
            ]),
        }));
        copyFloat(src);

        const roundPattern = {
            mode: "round" as const,
            canvasWidth: 8, canvasHeight: 8,
            virtualWidth: 8, virtualHeight: 8,
            offsetX: 0, offsetY: 0, rounds: 2,
        };
        // Build a destination with round-pattern holes. Easier: use the
        // wasm initializer directly via rowSession then override mode and
        // pixels.
        const dest = new Store(rowSession(8, 8, { pixels: filledPixels(8, 8, 1) }));
        // Manually craft a hole at the spot we know the paste will hit:
        dest.commit(s => {
            (s.pattern as { mode: string }) = roundPattern as never;
            const pix = s.pixels.slice();
            pix[7 * 8 + 7] = 0;   // explicit hole at (7,7)
            s.pixels = pix;
        });

        pasteClipboard(dest);
        // The hole cell stays a hole (paste float did NOT include it).
        expect(inFloat(dest.state.float!, 7, 7)).toBe(false);
        // Non-hole cells were claimed.
        expect(inFloat(dest.state.float!, 0, 0)).toBe(true);
    });
});
