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

    test("packed byte count is ceil(N/8)", () => {
        // Kills `Math.ceil(pixels.length / 8)` → `* 8` (output buffer
        // would be 64× larger but bit positions still decode the same,
        // so a round-trip test misses it — only the encoded length does).
        for (const n of [1, 8, 9, 16, 17]) {
            const out = atob(packPixels(new Uint8Array(n)));
            expect(out.length).toBe(Math.ceil(n / 8));
        }
    });

    test("hole cells stay 0 after unpack regardless of packed bits", () => {
        // Kills `if (out[i] !== 0)` → `if (true)`: that mutation would
        // overwrite hole cells with the packed A/B bit. We construct a
        // round pattern where some cells are holes and verify they survive.
        const pattern = {
            mode: "round" as const,
            canvasWidth: 8, canvasHeight: 8,
            virtualWidth: 8, virtualHeight: 8,
            offsetX: 0, offsetY: 0, rounds: 2,
        };
        // All-ones packed string → every non-hole cell becomes B (=2),
        // every hole stays 0. If the guard were `true`, holes would
        // become 1 or 2.
        const allBits = btoa("\xff".repeat(8));   // 64 cells, all bits 1
        const out = unpackPixels(allBits, pattern);
        // Find at least one hole cell (round patterns have holes outside
        // the rounded region) and assert it's still 0.
        const holeCount = [...out].filter(v => v === 0).length;
        expect(holeCount).toBeGreaterThan(0);
    });

    test("unpackPixels honours round-mode geometry (not the row default)", () => {
        // Kills `state.mode === "row"` → `true`: would always use the row
        // initializer, dropping the round-mode hole pattern.
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
        // Row mode: no holes; round mode: at least one hole.
        const rowHoles = [...rowOut].filter(v => v === 0).length;
        const roundHoles = [...roundOut].filter(v => v === 0).length;
        expect(rowHoles).toBe(0);
        expect(roundHoles).toBeGreaterThan(0);
    });
});

describe("packSelection / unpackSelection", () => {
    test("round-trip preserves the mask bits", () => {
        const bits = new Uint8Array([1, 0, 1, 1, 0, 0, 1, 0, 0]);
        const out = unpackSelection(packSelection(bits), bits.length);
        for (let i = 0; i < bits.length; i++) expect(out[i]).toBe(bits[i]);
    });

    test("packed byte count is ceil(N/8)", () => {
        // Same Math.ceil(/8) → *8 mutant as in packPixels.
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

    test("wrong version → null even with otherwise-valid payload", () => {
        // Kills LogicalOperator/ConditionalExpression survivors on the
        // version check: writing a payload that's structurally valid
        // EXCEPT for the version. If the version guard is skipped, the
        // function would try to load and either return junk or throw —
        // either way, not null in the structural-valid case unless the
        // guard fires.
        const valid = rowSession(3, 3);
        saveToLocalStorage(valid);
        const raw = JSON.parse(localStorage.getItem("mosaic-pattern-v3")!);
        raw.version = 999;
        localStorage.setItem("mosaic-pattern-v3", JSON.stringify(raw));
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("missing state → null", () => {
        // Kills the `!data.state` term of the version guard. Without
        // state, unpackPixels would throw on undefined.canvasWidth → null
        // via catch. With state but wrong type, no throw → would not be
        // null. We use a no-state payload to pin the state-existence guard.
        localStorage.setItem("mosaic-pattern-v3", JSON.stringify({ version: 3, pixels: "" }));
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("malformed JSON → null and clears the bad blob", () => {
        localStorage.setItem("mosaic-pattern-v3", "{not json");
        expect(loadFromLocalStorage()).toBeNull();
        expect(localStorage.getItem("mosaic-pattern-v3")).toBeNull();
    });

    test("non-square canvas with float round-trips correctly", () => {
        // Kills `data.state.canvasWidth * data.state.canvasHeight` → `/`:
        // for width=4, height=2 → cells=8 (correct) vs cells=2 (mutant).
        // With cells=2, unpackFloat builds 2-length arrays and the
        // mask bit at index 6 won't survive the round-trip.
        const f = makeFloat(4, 2, [{ x: 3, y: 1, v: 2 }]);
        const s = rowSession(4, 2, { pixels: filledPixels(4, 2, 1), float: f });
        saveToLocalStorage(s);
        const loaded = loadFromLocalStorage();
        expect(loaded).not.toBeNull();
        expect(loaded!.float!.mask.length).toBe(8);
        expect(loaded!.float!.mask[1 * 4 + 3]).toBe(1);
        expect(loaded!.float!.pixels[1 * 4 + 3]).toBe(2);
    });
});
