import { describe, test, expect } from "vitest";
import {
    packPixels, unpackPixels, packSelection, unpackSelection,
    packFloat, unpackFloat,
} from "../src/storage";
import { filledPixels, makeFloat } from "./_helpers";

describe("packPixels / unpackPixels", () => {
    test("round-trip preserves A/B values on non-hole cells", () => {
        const pattern = { mode: "row" as const, canvasWidth: 4, canvasHeight: 3 };
        const original = filledPixels(4, 3, 2);
        const packed = packPixels(original);
        const out = unpackPixels(packed, pattern);
        for (let i = 0; i < original.length; i++) {
            expect(out[i]).toBe(original[i]);
        }
    });

    test("on-disk encoding flips A↔1, B↔2 cleanly through unpack", () => {
        const pattern = { mode: "row" as const, canvasWidth: 2, canvasHeight: 1 };
        const original = new Uint8Array([1, 2]);
        const out = unpackPixels(packPixels(original), pattern);
        expect(out[0]).toBe(1);
        expect(out[1]).toBe(2);
    });

    test("packed byte count is ceil(N/8)", () => {
        for (const n of [1, 8, 9, 16, 17]) {
            const out = atob(packPixels(new Uint8Array(n)));
            expect(out.length).toBe(Math.ceil(n / 8));
        }
    });

    test("hole cells stay 0 after unpack regardless of packed bits", () => {
        const pattern = {
            mode: "round" as const,
            canvasWidth: 8, canvasHeight: 8,
            virtualWidth: 8, virtualHeight: 8,
            offsetX: 0, offsetY: 0, rounds: 2,
        };
        const allBits = btoa("\xff".repeat(8));
        const out = unpackPixels(allBits, pattern);
        const holeCount = [...out].filter(v => v === 0).length;
        expect(holeCount).toBeGreaterThan(0);
    });

    test("unpackPixels honours round-mode geometry (not the row default)", () => {
        const rowPat = { mode: "row" as const, canvasWidth: 8, canvasHeight: 8 };
        const roundPat = {
            mode: "round" as const,
            canvasWidth: 8, canvasHeight: 8,
            virtualWidth: 8, virtualHeight: 8,
            offsetX: 0, offsetY: 0, rounds: 2,
        };
        const empty = packPixels(new Uint8Array(64));
        const rowOut = unpackPixels(empty, rowPat);
        const roundOut = unpackPixels(empty, roundPat);
        expect([...rowOut].filter(v => v === 0).length).toBe(0);
        expect([...roundOut].filter(v => v === 0).length).toBeGreaterThan(0);
    });
});

describe("packSelection / unpackSelection", () => {
    test("round-trip preserves the mask bits", () => {
        const bits = new Uint8Array([1, 0, 1, 1, 0, 0, 1, 0, 0]);
        const out = unpackSelection(packSelection(bits), bits.length);
        for (let i = 0; i < bits.length; i++) expect(out[i]).toBe(bits[i]);
    });

    test("packed byte count is ceil(N/8)", () => {
        for (const n of [1, 8, 9, 16, 17]) {
            const out = atob(packSelection(new Uint8Array(n)));
            expect(out.length).toBe(Math.ceil(n / 8));
        }
    });
});

describe("packFloat / unpackFloat", () => {
    test("round-trip preserves mask, lifted pixels at masked positions, and offset", () => {
        const f = makeFloat(4, 4, [{ x: 0, y: 0, v: 1 }, { x: 2, y: 2, v: 2 }], 3, -1);
        const out = unpackFloat(packFloat(f), 16);
        expect(out.dx).toBe(3);
        expect(out.dy).toBe(-1);
        expect(out.mask[0]).toBe(1);
        expect(out.mask[2 * 4 + 2]).toBe(1);
        expect(out.pixels[0]).toBe(1);
        expect(out.pixels[2 * 4 + 2]).toBe(2);
        expect(out.pixels[1]).toBe(0);
    });
});
