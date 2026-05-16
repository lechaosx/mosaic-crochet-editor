// @vitest-environment jsdom
// localStorage IO tests — pure pack/unpack tests live in logic/tests/storage.test.ts.

import { describe, test, expect, beforeEach } from "vitest";
import { saveToLocalStorage, loadFromLocalStorage } from "../src/storage-io";
import { rowSession, filledPixels, makeFloat } from "./_helpers";

beforeEach(() => { localStorage.clear(); });

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
