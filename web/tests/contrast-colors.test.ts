import { describe, expect, test } from "vitest";
import { contrastingProjectColors } from "../src/contrast-colors";

function relativeLuminance(color: string): number {
    const channels = [1, 3, 5].map(offset => {
        const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: string, b: string): number {
    const first = relativeLuminance(a), second = relativeLuminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("contrastingProjectColors", () => {
    test.each([
        ["black", "#000000", "#000000"],
        ["white", "#ffffff", "#ffffff"],
        ["mid-gray", "#777777", "#777777"],
        ["similar mid-tones", "#707070", "#808080"],
        ["black and white", "#000000", "#ffffff"],
    ])("chooses two distinct colours with at least 3:1 contrast for %s yarns", (_name, yarnA, yarnB) => {
        const colors = contrastingProjectColors(yarnA, yarnB);

        expect(colors.danger).not.toBe(colors.accent);
        for (const color of [colors.danger, colors.accent]) {
            expect(Math.min(contrastRatio(color, yarnA), contrastRatio(color, yarnB))).toBeGreaterThanOrEqual(3);
        }
        expect(contrastingProjectColors(yarnB, yarnA)).toEqual(colors);
    });

    test("returns the deterministic best fallback when 3:1 against both yarns is impossible", () => {
        const colors = contrastingProjectColors("#3b3b3b", "#aaaaaa");

        expect(contrastingProjectColors("#aaaaaa", "#3b3b3b")).toEqual(colors);
        expect(colors).toEqual({ danger: "#d32f2f", accent: "#eefaff" });
        expect(colors.danger).not.toBe(colors.accent);
    });
});
