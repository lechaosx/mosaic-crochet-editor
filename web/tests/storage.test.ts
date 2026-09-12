// @vitest-environment jsdom
// localStorage IO tests — pure pack/unpack tests live in logic/tests/storage.test.ts.

import { describe, test, expect, beforeEach } from "vitest";
import { saveToLocalStorage, loadFromLocalStorage } from "../src/storage-io";
import { rowSession, filledPixels, makeFloat } from "./_helpers";
import { addAxis } from "@mosaic/logic/symmetry";

beforeEach(() => { localStorage.clear(); });

describe("saveToLocalStorage / loadFromLocalStorage", () => {
    test("round-trip preserves all serialised session fields", () => {
        const s = rowSession(3, 3, {
            colorA: "#11ff22",
            colorB: "#abcdef",
            activeTool: "fill",
            primaryColor: 2,
            axes: addAxis(addAxis([], "V", 3, 3), "H", 3, 3),
            hlOpacity: 42,
            invalidIntensity: 17,
            labelsVisible: false,
            lockInvalid: true,
            rotation: 90,
            pixels: filledPixels(3, 3, 2),
            float: makeFloat([{ x: 2, y: 0, v: 1 }]),
        });
        saveToLocalStorage(s);
        const loaded = loadFromLocalStorage();
        expect(loaded).not.toBeNull();
        expect(loaded!.colorA).toBe("#11ff22");
        expect(loaded!.activeTool).toBe("fill");
        expect(loaded!.primaryColor).toBe(2);
        expect(loaded!.axes).toHaveLength(2);
        expect(loaded!.axes.find(a => a.kind === "V")!.active).toBe(true);
        expect(loaded!.axes.find(a => a.kind === "H")!.active).toBe(true);
        expect(loaded!.hlOpacity).toBe(42);
        expect(loaded!.invalidIntensity).toBe(17);
        expect(loaded!.labelsVisible).toBe(false);
        expect(loaded!.lockInvalid).toBe(true);
        expect(loaded!.rotation).toBe(90);
        expect(loaded!.pixels[0]).toBe(2);
        expect(loaded!.float).not.toBeNull();
        expect(loaded!.float!.x).toBe(2);
        expect(loaded!.float!.y).toBe(0);
        expect(loaded!.float!.pixels[0]).toBe(1);
    });

    test("nothing in localStorage → null", () => {
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("wrong version → null even with otherwise-valid payload", () => {
        const valid = rowSession(3, 3);
        saveToLocalStorage(valid);
        const raw = JSON.parse(localStorage.getItem("mosaic-pattern-v4")!);
        raw.version = 999;
        localStorage.setItem("mosaic-pattern-v4", JSON.stringify(raw));
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("missing state → null", () => {
        localStorage.setItem("mosaic-pattern-v4", JSON.stringify({ version: 4, pixels: "" }));
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("malformed JSON → null and clears the bad blob", () => {
        localStorage.setItem("mosaic-pattern-v4", "{not json");
        expect(loadFromLocalStorage()).toBeNull();
        expect(localStorage.getItem("mosaic-pattern-v4")).toBeNull();
    });

    test("oversized saved dimensions are rejected before pixel allocation", () => {
        const valid = rowSession(3, 3);
        saveToLocalStorage(valid);
        const raw = JSON.parse(localStorage.getItem("mosaic-pattern-v4")!);
        raw.state.canvasWidth = 1_048_577;
        raw.state.canvasHeight = 1;
        localStorage.setItem("mosaic-pattern-v4", JSON.stringify(raw));

        expect(loadFromLocalStorage()).toBeNull();
        expect(localStorage.getItem("mosaic-pattern-v4")).toBeNull();
    });

    test("non-square canvas with float round-trips correctly", () => {
        const f = makeFloat([{ x: 3, y: 1, v: 2 }]);
        const s = rowSession(4, 2, { pixels: filledPixels(4, 2, 1), float: f });
        saveToLocalStorage(s);
        const loaded = loadFromLocalStorage();
        expect(loaded).not.toBeNull();
        expect(loaded!.float!.x).toBe(3);
        expect(loaded!.float!.y).toBe(1);
        expect(loaded!.float!.pixels[0]).toBe(2);
    });
});
