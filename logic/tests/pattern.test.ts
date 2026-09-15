// Pure pattern helper tests — no DOM needed (parameters passed directly).
import { describe, test, expect } from "vitest";
import {
    applyEditSettings, EditSettings, patternChangeSummary, patternDimensionError,
} from "../src/pattern";

const rowBase: EditSettings = { mode: "row", width: 4, height: 3, wipe: false };

describe("applyEditSettings (row mode)", () => {
    test("builds a fresh row pattern at the requested dims", () => {
        const { pattern, pixels } = applyEditSettings(rowBase);
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
        const { pixels } = applyEditSettings(rowBase, source);
        expect(pixels[0]).toBe(2);
        expect(pixels[4]).toBe(1);
    });

    test("wipe=true starts from fresh natural baseline", () => {
        const source = {
            pattern: { mode: "row" as const, canvasWidth: 4, canvasHeight: 3 },
            pixels:  new Uint8Array(12).fill(2),
        };
        const { pixels } = applyEditSettings({ ...rowBase, wipe: true }, source);
        expect(pixels[0]).toBe(1);
    });

    test("rejects dimensions beyond the per-axis safety ceiling before allocation", () => {
        expect(() => applyEditSettings({
            mode: "row", width: 1_048_577, height: 1, wipe: true,
        })).toThrow(/1,048,576/);
    });

    test("rejects a canvas above the total cell ceiling before allocation", () => {
        expect(() => applyEditSettings({
            mode: "row", width: 4_097, height: 4_097, wipe: true,
        })).toThrow(/16,777,216/);
    });
});

describe("patternChangeSummary", () => {
    test("reports simultaneous preservation, addition, and removal", () => {
        const source = applyEditSettings({
            mode: "row", width: 4, height: 3, wipe: true,
        });
        const settings: EditSettings = {
            mode: "row", width: 6, height: 2, wipe: false,
        };
        const result = applyEditSettings(settings, source);

        expect(patternChangeSummary(settings, source, result)).toEqual({
            width: 6,
            height: 2,
            preserved: 8,
            added: 4,
            removed: 4,
        });
    });

    test("reports a deliberate blank pattern as replacing every cell", () => {
        const source = applyEditSettings({
            mode: "row", width: 4, height: 3, wipe: true,
        });
        const settings: EditSettings = {
            mode: "row", width: 4, height: 3, wipe: true,
        };
        const result = applyEditSettings(settings, source);

        expect(patternChangeSummary(settings, source, result)).toEqual({
            width: 4,
            height: 3,
            preserved: 0,
            added: 12,
            removed: 12,
        });
    });
});

describe("applyEditSettings (round mode)", () => {
    const roundBase: EditSettings = {
        mode: "round", innerWidth: 2, innerHeight: 2, rounds: 3, subMode: "full", wipe: false,
    };

    test("full mode: canvas = virtual = inner + 2*rounds in both dimensions", () => {
        const { pattern } = applyEditSettings(roundBase);
        expect(pattern.mode).toBe("round");
        if (pattern.mode === "round") {
            expect(pattern.canvasWidth).toBe(2 + 2 * 3);
            expect(pattern.canvasHeight).toBe(2 + 2 * 3);
            expect(pattern.virtualWidth).toBe(2 + 2 * 3);
            expect(pattern.virtualHeight).toBe(2 + 2 * 3);
            expect(pattern.rounds).toBe(3);
        }
        const { pixels } = applyEditSettings(roundBase);
        expect([...pixels].some(v => v === 0)).toBe(true);
    });

    test("half sub-mode: canvas height = inner + rounds, offsetY = rounds", () => {
        const { pattern } = applyEditSettings({ ...roundBase, subMode: "half" });
        expect(pattern.mode).toBe("round");
        if (pattern.mode === "round") {
            expect(pattern.canvasWidth).toBe(2 + 2 * 3);
            expect(pattern.canvasHeight).toBe(2 + 3);
            expect(pattern.offsetY).toBe(3);
        }
    });

    test("quarter sub-mode: canvas width = inner + rounds too", () => {
        const { pattern } = applyEditSettings({ ...roundBase, subMode: "quarter" });
        expect(pattern.mode).toBe("round");
        if (pattern.mode === "round") {
            expect(pattern.canvasWidth).toBe(2 + 3);
            expect(pattern.canvasHeight).toBe(2 + 3);
        }
    });
});

describe("applyEditSettings (dev asserts)", () => {
    test("unknown subMode throws", () => {
        expect(() => applyEditSettings(
            { mode: "round", innerWidth: 2, innerHeight: 2, rounds: 3, subMode: "weird" as any, wipe: false },
        )).toThrow(/unknown subMode/);
    });

    test("unknown mode throws", () => {
        expect(() => applyEditSettings({ mode: "weird" as any, wipe: false }))
            .toThrow(/applyEditSettings: unknown mode/);
    });
});

describe("patternDimensionError", () => {
    test("accepts the square and narrow forms of the total-cell boundary", () => {
        expect(patternDimensionError({
            mode: "row", canvasWidth: 4_096, canvasHeight: 4_096,
        })).toBeNull();
        expect(patternDimensionError({
            mode: "row", canvasWidth: 1_048_576, canvasHeight: 16,
        })).toBeNull();
    });

    test("rejects non-integer dimensions", () => {
        expect(patternDimensionError({
            mode: "row", canvasWidth: 2.5, canvasHeight: 2,
        })).toMatch(/whole positive numbers/);
    });

    test("validates round geometry without allocating its canvas", () => {
        expect(patternDimensionError({
            mode: "round",
            canvasWidth: 4_096,
            canvasHeight: 4_096,
            virtualWidth: 8_192,
            virtualHeight: 8_192,
            offsetX: 0,
            offsetY: 4_096,
            rounds: 4_096,
        })).toBeNull();
        expect(patternDimensionError({
            mode: "round",
            canvasWidth: 8,
            canvasHeight: 8,
            virtualWidth: 10,
            virtualHeight: 10,
            offsetX: 0,
            offsetY: 5,
            rounds: 2,
        })).toMatch(/Centre-out pattern geometry/);
    });
});

describe("applyEditSettings (mode preservation)", () => {
    test("row→round mode switch: round buffer has holes intact", () => {
        const source = {
            pattern: { mode: "row" as const, canvasWidth: 4, canvasHeight: 3 },
            pixels:  new Uint8Array(12).fill(2),
        };
        const { pattern, pixels } = applyEditSettings(
            { mode: "round", innerWidth: 2, innerHeight: 2, rounds: 3, subMode: "full", wipe: false },
            source,
        );
        expect(pattern.mode).toBe("round");
        if (pattern.mode === "round") {
            expect(pixels.length).toBe(pattern.canvasWidth * pattern.canvasHeight);
        }
        expect([...pixels].some(v => v === 0)).toBe(true);
        const fresh = applyEditSettings(
            { mode: "round", innerWidth: 2, innerHeight: 2, rounds: 3, subMode: "full", wipe: true },
            source,
        );
        expect(pixels).toEqual(fresh.pixels);
    });

    test("round→row mode switch starts from a fresh row pattern", () => {
        const round = applyEditSettings({
            mode: "round", innerWidth: 2, innerHeight: 2, rounds: 2, subMode: "full", wipe: true,
        });
        const sourcePixels = round.pixels.slice();
        for (let i = 0; i < sourcePixels.length; i++) {
            if (sourcePixels[i] !== 0) sourcePixels[i] = 2;
        }
        const settings: EditSettings = { mode: "row", width: 5, height: 4, wipe: false };
        const resized = applyEditSettings(settings, { pattern: round.pattern, pixels: sourcePixels });
        const fresh = applyEditSettings({ ...settings, wipe: true });
        expect(resized.pixels).toEqual(fresh.pixels);
    });

    test("round→round resize preserves edited cells", () => {
        const settings: EditSettings = {
            mode: "round", innerWidth: 2, innerHeight: 2, rounds: 2, subMode: "full", wipe: false,
        };
        const source = applyEditSettings({ ...settings, wipe: true });
        const edited = source.pixels.slice();
        const index = edited.findIndex(v => v !== 0);
        edited[index] = edited[index] === 1 ? 2 : 1;

        const resized = applyEditSettings(settings, { pattern: source.pattern, pixels: edited });
        expect(resized.pixels[index]).toBe(edited[index]);
    });
});
