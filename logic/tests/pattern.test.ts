// Pure pattern helper tests — no DOM needed (parameters passed directly).
import { describe, test, expect } from "vitest";
import { applyEditSettings, EditSettings } from "../src/pattern";

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
        expect(() => applyEditSettings({ mode: "weird" as any, wipe: false })).toThrow();
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
    });
});
