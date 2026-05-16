// Float namespace constructor helpers.
import { describe, test, expect } from "vitest";
import { Float } from "../src/types";
import { makeFloat } from "./_helpers";

describe("Float.shifted", () => {
    test("returns same mask/pixels with new offset", () => {
        const f = makeFloat(3, 3, [{ x: 0, y: 0, v: 1 }], 0, 0);
        const shifted = Float.shifted(f, 5, -3);
        expect(shifted.mask).toBe(f.mask);
        expect(shifted.pixels).toBe(f.pixels);
        expect(shifted.dx).toBe(5);
        expect(shifted.dy).toBe(-3);
    });
});

describe("Float.withPixels", () => {
    test("returns same mask + offset with new pixels", () => {
        const f = makeFloat(3, 3, [{ x: 0, y: 0, v: 1 }], 2, 2);
        const newPixels = new Uint8Array(9);
        const out = Float.withPixels(f, newPixels);
        expect(out.mask).toBe(f.mask);
        expect(out.pixels).toBe(newPixels);
        expect(out.dx).toBe(2);
        expect(out.dy).toBe(2);
    });
});
