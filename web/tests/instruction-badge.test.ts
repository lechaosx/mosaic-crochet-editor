import { expect, test } from "vitest";
import { instructionBadgeTextColor } from "../src/ui";

test("instruction badges choose text by sRGB relative luminance", () => {
    expect(instructionBadgeTextColor("#00a000")).toBe("#000000");
    expect(instructionBadgeTextColor("#123456")).toBe("#ffffff");
    expect(instructionBadgeTextColor("#abcdef")).toBe("#000000");
    expect(instructionBadgeTextColor("#767676")).toBe("#000000");
    expect(instructionBadgeTextColor("#757575")).toBe("#ffffff");
    expect(instructionBadgeTextColor("#777777")).toBe("#000000");
});
