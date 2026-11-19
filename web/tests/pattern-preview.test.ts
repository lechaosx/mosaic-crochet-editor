// @vitest-environment jsdom

import { expect, test } from "vitest";
import { PlanCell } from "@mosaic/wasm";
import { patternColourPreviewSample } from "../src/render";

for (const [mode, extent, axis] of [["row", "full", "V"], ["round", "full", "D2"], ["round", "half", "V"], ["round", "quarter", "D2"]] as const) {
    test(`${mode} ${extent} preview data follows its central ${axis} mirror`, () => {
        const { pattern, pixels } = patternColourPreviewSample(mode, extent);
        const W = pattern.canvasWidth, H = pattern.canvasHeight;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const targetX = axis === "V" ? W - 1 - x : W - 1 - y;
            const targetY = axis === "V" ? y : H - 1 - x;
            expect(pixels[y * W + x]).toBe(pixels[targetY * W + targetX]);
        }
    });
}

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
        const marked = [...plan.keys()].filter(index => plan[index] !== 0)
            .map(index => ({ x: index % pattern.canvasWidth, y: Math.floor(index / pattern.canvasWidth), cell: plan[index] }));
        expect(marked.some(({ cell }) => !(cell & PlanCell.Invalid))).toBe(true);
        const invalid = marked.filter(({ cell }) => cell & PlanCell.Invalid);
        expect(invalid.length).toBeGreaterThan(0);
        for (const { x, y } of invalid) {
            const virtualX = x + pattern.offsetX;
            const virtualY = y + pattern.offsetY;
            expect(Math.min(virtualX, 6 - virtualX)).not.toBe(Math.min(virtualY, 6 - virtualY));
            expect(pixels[y * pattern.canvasWidth + x]).not.toBe(0);
        }
    });
}
