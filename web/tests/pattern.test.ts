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
    test("switches to round geometry", () => {
        // Flip the radio to round.
        (document.querySelector('[name="edit-mode"][value="row"]') as HTMLInputElement).checked = false;
        (document.querySelector('[name="edit-mode"][value="round"]') as HTMLInputElement).checked = true;
        const { pattern } = applyEditSettings();
        expect(pattern.mode).toBe("round");
        if (pattern.mode === "round") {
            // full sub-mode: canvas = virtual = inner + 2*rounds.
            expect(pattern.canvasWidth).toBe(2 + 2 * 3);
            expect(pattern.rounds).toBe(3);
        }
    });
});
