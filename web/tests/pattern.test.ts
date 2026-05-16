// @vitest-environment jsdom
// Edit-popover pure helper. Reads DOM inputs and builds a fresh pattern
// (preserving pixels through `transfer_preserved_*` when not wiping).

import { describe, test, expect, beforeEach } from "vitest";
import { applyEditSettings } from "../src/pattern";

function seedEditDom() {
    document.body.innerHTML = `
        <input type="radio" name="edit-mode" value="row" checked>
        <input type="radio" name="edit-mode" value="round">
        <input type="number" id="edit-width"  value="4">
        <input type="number" id="edit-height" value="3">
        <input type="number" id="edit-inner-width"  value="2">
        <input type="number" id="edit-inner-height" value="2">
        <input type="number" id="edit-rounds"       value="3">
        <input type="radio" name="edit-submode" value="full"    checked>
        <input type="radio" name="edit-submode" value="half">
        <input type="radio" name="edit-submode" value="quarter">
        <input type="checkbox" id="edit-wipe">
    `;
}

beforeEach(seedEditDom);

describe("applyEditSettings (row mode)", () => {
    test("builds a fresh row pattern at the requested dims", () => {
        const { pattern, pixels } = applyEditSettings();
        expect(pattern.mode).toBe("row");
        if (pattern.mode === "row") {
            expect(pattern.canvasWidth).toBe(4);
            expect(pattern.canvasHeight).toBe(3);
        }
        expect(pixels.length).toBe(12);
    });

    test("preserves source pixels when wipe is off", () => {
        const source = {
            pattern: { mode: "row" as const, canvasWidth: 4, canvasHeight: 3 },
            pixels:  new Uint8Array([2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2]),
        };
        const { pixels } = applyEditSettings(source);
        // Same dims & wipe off → values preserved.
        expect(pixels[0]).toBe(2);
        expect(pixels[4]).toBe(1);
    });

    test("wipe=on starts from fresh natural baseline", () => {
        (document.getElementById("edit-wipe") as HTMLInputElement).checked = true;
        const source = {
            pattern: { mode: "row" as const, canvasWidth: 4, canvasHeight: 3 },
            pixels:  new Uint8Array(12).fill(2),
        };
        const { pixels } = applyEditSettings(source);
        // Row 0 natural baseline = colour A = 1.
        expect(pixels[0]).toBe(1);
    });
});

describe("applyEditSettings (round mode)", () => {
    function selectRoundMode() {
        (document.querySelector('[name="edit-mode"][value="row"]') as HTMLInputElement).checked = false;
        (document.querySelector('[name="edit-mode"][value="round"]') as HTMLInputElement).checked = true;
    }
    function selectSubmode(value: "full" | "half" | "quarter") {
        for (const v of ["full", "half", "quarter"] as const) {
            (document.querySelector(`[name="edit-submode"][value="${v}"]`) as HTMLInputElement).checked = (v === value);
        }
    }

    test("full mode: canvas = virtual = inner + 2*rounds in both dimensions", () => {
        // Kills `rounds * 2` → `/ 2` on lines 13/14 (inside
        // computeRoundDimensions) AND on lines 46/47 (the duplicate that
        // populates newPattern.virtualWidth/Height).
        selectRoundMode();
        const { pattern } = applyEditSettings();
        expect(pattern.mode).toBe("round");
        if (pattern.mode === "round") {
            expect(pattern.canvasWidth).toBe(2 + 2 * 3);
            expect(pattern.canvasHeight).toBe(2 + 2 * 3);
            expect(pattern.virtualWidth).toBe(2 + 2 * 3);
            expect(pattern.virtualHeight).toBe(2 + 2 * 3);
            expect(pattern.rounds).toBe(3);
        }
        // Round-mode pixel buffer is non-trivial: must have at least one
        // hole cell (the cells outside the rounded region).
        const { pixels } = applyEditSettings();
        expect([...pixels].some(v => v === 0)).toBe(true);
    });

    test("half sub-mode: canvas height = inner + rounds (single rim), offsetY = rounds", () => {
        // Kills `if (subMode === "full")` → `if (true)`: skipping the
        // half/quarter branches would force half-mode to take full's
        // canvasHeight = inner + 2*rounds and offsetY = 0.
        selectRoundMode();
        selectSubmode("half");
        const { pattern } = applyEditSettings();
        expect(pattern.mode).toBe("round");
        if (pattern.mode === "round") {
            expect(pattern.canvasWidth).toBe(2 + 2 * 3);  // full width
            expect(pattern.canvasHeight).toBe(2 + 3);     // inner + 1 rim
            expect(pattern.offsetY).toBe(3);
        }
    });

    test("quarter sub-mode: canvas width = inner + rounds too (one rim each axis)", () => {
        selectRoundMode();
        selectSubmode("quarter");
        const { pattern } = applyEditSettings();
        expect(pattern.mode).toBe("round");
        if (pattern.mode === "round") {
            expect(pattern.canvasWidth).toBe(2 + 3);     // inner + 1 rim
            expect(pattern.canvasHeight).toBe(2 + 3);
        }
    });
});

describe("applyEditSettings (dev asserts)", () => {
    test("unknown subMode throws (dev assert)", () => {
        // Kills `devAssert(subMode === "quarter", ...)` mutations: with
        // `devAssert(true, ...)` or an empty message, this test would
        // either not throw or throw with the wrong message.
        (document.querySelector('[name="edit-mode"][value="row"]') as HTMLInputElement).checked = false;
        (document.querySelector('[name="edit-mode"][value="round"]') as HTMLInputElement).checked = true;
        // Inject an unknown subMode value.
        document.body.insertAdjacentHTML("beforeend",
            `<input type="radio" name="edit-submode" value="weird" checked>`);
        // Make sure the existing ones are unchecked.
        for (const v of ["full", "half", "quarter"]) {
            (document.querySelector(`[name="edit-submode"][value="${v}"]`) as HTMLInputElement).checked = false;
        }
        expect(() => applyEditSettings()).toThrow(/unknown subMode/);
    });

    test("unknown edit-mode throws (dev assert)", () => {
        // Kills `devAssert(mode === "round", ...)` mutations.
        for (const v of ["row", "round"]) {
            (document.querySelector(`[name="edit-mode"][value="${v}"]`) as HTMLInputElement).checked = false;
        }
        document.body.insertAdjacentHTML("beforeend",
            `<input type="radio" name="edit-mode" value="weird" checked>`);
        expect(() => applyEditSettings()).toThrow(/unknown edit-mode/);
    });
});

describe("applyEditSettings (mode preservation)", () => {
    test("row→round mode switch: doesn't run transfer_preserved_row (which would corrupt round indices)", () => {
        // Kills mutations on `if (old.mode === "row" && newPattern.mode === "row")`:
        // `||` instead of `&&`, or `if (true)` etc. would route a row
        // source through the row transfer into a round buffer, producing
        // either an error or pixel patterns inconsistent with the round
        // initializer (no holes preserved).
        (document.querySelector('[name="edit-mode"][value="row"]') as HTMLInputElement).checked = false;
        (document.querySelector('[name="edit-mode"][value="round"]') as HTMLInputElement).checked = true;
        const source = {
            pattern: { mode: "row" as const, canvasWidth: 4, canvasHeight: 3 },
            pixels:  new Uint8Array(12).fill(2),
        };
        const { pattern, pixels } = applyEditSettings(source);
        expect(pattern.mode).toBe("round");
        if (pattern.mode === "round") {
            const totalCells = pattern.canvasWidth * pattern.canvasHeight;
            expect(pixels.length).toBe(totalCells);
        }
        // Round buffer's hole pattern must be intact (i.e. the round
        // initializer wasn't overwritten by a row-transfer call).
        expect([...pixels].some(v => v === 0)).toBe(true);
    });
});
