import { describe, expect, test } from "vitest";
import { resolveMoveInput, resolveToolInput, type ToolInput } from "../src/tool-input";
import { defaultToolVariants } from "../src/types";

const left: ToolInput = { button: 0, shift: false, ctrl: false, alt: false };

describe("tool input resolution", () => {
    test.each(["select", "wand"] as const)("%s modifiers precede buttons and its own remembered choice", tool => {
        const variants = { ...defaultToolVariants(), select: "add", wand: "remove" } as const;
        expect(resolveToolInput(tool, variants, 1, left)).toEqual({ kind: tool, mode: variants[tool] });
        for (const button of [0, 2] as const) {
            expect(resolveToolInput(tool, variants, 1, { ...left, button, shift: true, ctrl: true }))
                .toEqual({ kind: tool, mode: "add" });
            expect(resolveToolInput(tool, variants, 1, { ...left, button, ctrl: true }))
                .toEqual({ kind: tool, mode: "remove" });
        }
        expect(resolveToolInput(tool, variants, 1, { ...left, button: 2 })).toEqual({ kind: tool, mode: "add" });
        expect(variants).toEqual({ select: "add", wand: "remove", move: "move", overlay: "place" });
    });

    test("Move uses the same Alt, Ctrl, button and chosen precedence for keyboard and pointer", () => {
        for (const chosen of ["move", "duplicate", "mask-only"] as const) {
            expect(resolveMoveInput(chosen, left)).toBe(chosen);
            expect(resolveMoveInput(chosen, { ...left, button: 2 })).toBe("duplicate");
            for (const button of [0, 2] as const) {
                expect(resolveMoveInput(chosen, { ...left, button, alt: true, ctrl: true })).toBe("mask-only");
                expect(resolveMoveInput(chosen, { ...left, button, ctrl: true })).toBe("duplicate");
            }
        }
    });

    test.each([1, 2] as const)("colour accelerators snapshot selected Yarn %s", primary => {
        const variants = defaultToolVariants();
        for (const tool of ["pencil", "fill"] as const) {
            expect(resolveToolInput(tool, variants, primary, left)).toMatchObject({ tool, color: primary });
            expect(resolveToolInput(tool, variants, primary, { ...left, button: 2 }))
                .toMatchObject({ tool, color: primary === 1 ? 2 : 1 });
        }
        expect(resolveToolInput("eraser", variants, primary, left)).toMatchObject({ tool: "eraser", oppositeNatural: false });
        expect(resolveToolInput("eraser", variants, primary, { ...left, button: 2 }))
            .toMatchObject({ tool: "eraser", oppositeNatural: true });
    });

    test.each([
        ["place", "clear"], ["clear", "place"], ["invert", "invert"],
    ] as const)("Overlay %s uses %s for right-click", (chosen, right) => {
        const variants = { ...defaultToolVariants(), overlay: chosen };
        expect(resolveToolInput("overlay", variants, 2, left)).toMatchObject({ tool: "overlay", overlayAction: chosen });
        expect(resolveToolInput("overlay", variants, 2, { ...left, button: 2 }))
            .toMatchObject({ tool: "overlay", overlayAction: right });
        expect(variants.overlay).toBe(chosen);
    });
});
