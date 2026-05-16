// @vitest-environment jsdom
// Storage round-trip tests. jsdom for localStorage; the file save/load
// APIs use `window.showSaveFilePicker` etc. which we don't exercise
// here — those are E2E territory.

import { describe, test, expect, beforeEach } from "vitest";
import {
    packPixels, unpackPixels, packSelection, unpackSelection,
    packFloat, unpackFloat,
    saveToLocalStorage, loadFromLocalStorage,
} from "../src/storage";
import { rowSession, filledPixels, makeFloat } from "./_helpers";

beforeEach(() => { localStorage.clear(); });

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
});

describe("packSelection / unpackSelection", () => {
    test("round-trip preserves the mask bits", () => {
        const bits = new Uint8Array([1, 0, 1, 1, 0, 0, 1, 0, 0]);
        const out = unpackSelection(packSelection(bits), bits.length);
        for (let i = 0; i < bits.length; i++) expect(out[i]).toBe(bits[i]);
    });
});

describe("packFloat / unpackFloat", () => {
    test("round-trip preserves mask, lifted pixels at masked positions, and offset", () => {
        const f = makeFloat(4, 4, [{ x: 0, y: 0, v: 1 }, { x: 2, y: 2, v: 2 }], 3, -1);
        const out = unpackFloat(packFloat(f), 16);
        expect(out.dx).toBe(3);
        expect(out.dy).toBe(-1);
        // Mask preserved
        expect(out.mask[0]).toBe(1);
        expect(out.mask[2 * 4 + 2]).toBe(1);
        // Lifted pixel values preserved at masked cells
        expect(out.pixels[0]).toBe(1);
        expect(out.pixels[2 * 4 + 2]).toBe(2);
        // Non-masked positions have 0 (no garbage values)
        expect(out.pixels[1]).toBe(0);
    });
});

describe("saveToLocalStorage / loadFromLocalStorage", () => {
    test("round-trip preserves all serialised session fields", () => {
        const s = rowSession(3, 3, {
            colorA: "#11ff22",
            colorB: "#abcdef",
            activeTool: "fill",
            primaryColor: 2,
            symmetry: new Set(["V", "H"]),
            hlOpacity: 42,
            invalidIntensity: 17,
            labelsVisible: false,
            lockInvalid: true,
            rotation: 90,
            pixels: filledPixels(3, 3, 2),
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 1 }], 2, 0),
        });
        saveToLocalStorage(s);
        const loaded = loadFromLocalStorage();
        expect(loaded).not.toBeNull();
        expect(loaded!.colorA).toBe("#11ff22");
        expect(loaded!.activeTool).toBe("fill");
        expect(loaded!.primaryColor).toBe(2);
        expect(loaded!.symmetry.has("V")).toBe(true);
        expect(loaded!.hlOpacity).toBe(42);
        expect(loaded!.invalidIntensity).toBe(17);
        expect(loaded!.labelsVisible).toBe(false);
        expect(loaded!.lockInvalid).toBe(true);
        expect(loaded!.rotation).toBe(90);
        expect(loaded!.pixels[0]).toBe(2);
        expect(loaded!.float).not.toBeNull();
        expect(loaded!.float!.dx).toBe(2);
        expect(loaded!.float!.mask[0]).toBe(1);
        expect(loaded!.float!.pixels[0]).toBe(1);
    });

    test("nothing in localStorage → null", () => {
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("wrong version → null (blob kept; only parse errors clear it)", () => {
        localStorage.setItem("mosaic-pattern-v3", JSON.stringify({ version: 999 }));
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("malformed JSON → null and clears the bad blob", () => {
        localStorage.setItem("mosaic-pattern-v3", "{not json");
        expect(loadFromLocalStorage()).toBeNull();
        expect(localStorage.getItem("mosaic-pattern-v3")).toBeNull();
    });
});
