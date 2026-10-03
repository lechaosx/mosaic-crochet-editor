// @vitest-environment jsdom

import { expect, test } from "vitest";
import { PlanType } from "@mosaic/wasm";
import { patternColourPreviewSample } from "../src/render";

for (const extent of ["full", "half", "quarter"] as const) {
    test(`${extent} centre-out sample includes valid work and non-corner invalid placements`, () => {
        const { pattern, pixels, plan } = patternColourPreviewSample("round", extent);
        if (pattern.mode !== "round") throw new Error("Expected centre-out sample");
        expect(pattern.virtualWidth).toBe(7);
        expect(pattern.virtualHeight).toBe(7);
        const full = patternColourPreviewSample("round", "full");
        for (let y = 0; y < pattern.canvasHeight; y++) {
            for (let x = 0; x < pattern.canvasWidth; x++) {
                expect(pixels[y * pattern.canvasWidth + x]).toBe(
                    full.pixels[(y + pattern.offsetY) * full.pattern.canvasWidth + x + pattern.offsetX],
                );
            }
        }
        const entries = Array.from({ length: plan.length / 4 }, (_, index) => Array.from(plan.slice(index * 4, index * 4 + 4)));
        expect(entries.some(([type]) => type === PlanType.Valid)).toBe(true);
        const invalid = entries.filter(([type]) => type === PlanType.Invalid);
        expect(invalid.length).toBeGreaterThan(0);
        for (const [, , x, y] of invalid) {
            const virtualX = x + pattern.offsetX;
            const virtualY = y + pattern.offsetY;
            expect(Math.min(virtualX, 6 - virtualX)).not.toBe(Math.min(virtualY, 6 - virtualY));
            expect(pixels[y * pattern.canvasWidth + x]).not.toBe(0);
        }
    });
}
