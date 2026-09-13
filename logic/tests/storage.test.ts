import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
    packPixels, unpackPixels, packFloat, unpackFloat,
} from "../src/storage";
import { decodeMcw, encodeMcw } from "../src/mcw";
import { filledPixels } from "./_helpers";

function mcwFixture(name: string): string {
    return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe(".mcw codec", () => {
    test("loads a v1 fixture and upgrades it through a v2 round-trip", () => {
        const legacy = decodeMcw(mcwFixture("pattern-v1.mcw"));
        expect(legacy.pattern).toEqual({ mode: "row", canvasWidth: 2, canvasHeight: 2 });
        expect(Array.from(legacy.pixels)).toEqual([1, 2, 2, 1]);
        expect(legacy.colorA).toBe("#112233");
        expect(legacy.colorB).toBe("#ddeeff");

        const upgraded = decodeMcw(encodeMcw(legacy));
        expect(upgraded).toEqual(legacy);
    });

    test("loads a v2 fixture and preserves it through a v2 round-trip", () => {
        const current = decodeMcw(mcwFixture("pattern-v2.mcw"));
        expect(Array.from(current.pixels)).toEqual([1, 2, 1, 2]);

        const encoded = JSON.parse(encodeMcw(current));
        expect(encoded).toEqual({
            version: 2,
            state: { mode: "row", canvasWidth: 2, canvasHeight: 2 },
            pixels: "Cg==",
            colorA: "#010203",
            colorB: "#fafbfc",
        });
        expect(decodeMcw(JSON.stringify(encoded))).toEqual(current);
    });

    test.each([
        ["malformed JSON", "{"],
        ["missing fields", JSON.stringify({ version: 2 })],
        ["invalid v1 pixels", JSON.stringify({
            version: 1,
            state: { mode: "row", canvasWidth: 2, canvasHeight: 2 },
            pixels: [1, 2, 3, 1],
            colorA: "#000000",
            colorB: "#ffffff",
        })],
        ["short v2 pixels", JSON.stringify({
            version: 2,
            state: { mode: "row", canvasWidth: 9, canvasHeight: 1 },
            pixels: "AA==",
            colorA: "#000000",
            colorB: "#ffffff",
        })],
    ])("rejects %s", (_name, source) => {
        expect(() => decodeMcw(source)).toThrow("Invalid pattern file.");
    });

    test("identifies a future file version", () => {
        expect(() => decodeMcw(JSON.stringify({ version: 3 })))
            .toThrow("This pattern uses unsupported .mcw version 3.");
    });
});

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

describe("packFloat / unpackFloat", () => {
    test("round-trip preserves x, y, w, h, and pixels", () => {
        const fp = new Uint8Array([0, 1, 0, 2, 1, 0]);   // 3×2 bounding box
        const f = { x: -2, y: 5, w: 3, h: 2, pixels: fp };
        const out = unpackFloat(packFloat(f));
        expect(out.x).toBe(-2);
        expect(out.y).toBe(5);
        expect(out.w).toBe(3);
        expect(out.h).toBe(2);
        expect(Array.from(out.pixels)).toEqual([0, 1, 0, 2, 1, 0]);
    });
});
