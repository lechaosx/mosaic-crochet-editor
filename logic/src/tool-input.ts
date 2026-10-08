import type { Tool, ToolVariants } from "./types";

export interface ToolInput {
    button: 0 | 2;
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
}

export type PaintAction =
    | { kind: "paint"; tool: "pencil" | "fill" | "invert"; color: 1 | 2 }
    | { kind: "paint"; tool: "eraser"; color: 1 | 2; oppositeNatural: boolean }
    | { kind: "paint"; tool: "overlay"; color: 1 | 2; overlayAction: ToolVariants["overlay"] };

export type ToolAction = PaintAction
    | { kind: "select"; mode: ToolVariants["select"] }
    | { kind: "wand"; mode: ToolVariants["wand"] }
    | { kind: "move"; mode: ToolVariants["move"] };

export function resolveMoveInput(chosen: ToolVariants["move"], input: ToolInput): ToolVariants["move"] {
    return input.alt ? "mask-only" : input.ctrl ? "duplicate"
        : input.button === 2 ? "duplicate" : chosen;
}

export function resolveToolInput(tool: Tool, variants: ToolVariants, primary: 1 | 2, input: ToolInput): ToolAction {
    if (tool === "move") return { kind: "move", mode: resolveMoveInput(variants.move, input) };
    if (tool === "select" || tool === "wand") return {
        kind: tool,
        mode: input.shift ? "add" : input.ctrl ? "remove"
            : input.button === 2 ? "add" : variants[tool],
    };
    if (tool === "overlay") {
        const chosen = variants.overlay;
        const overlayAction = input.button === 2 ? chosen === "place" ? "clear" : chosen === "clear" ? "place" : "invert" : chosen;
        return { kind: "paint", tool, color: primary, overlayAction };
    }
    if (tool === "eraser") return { kind: "paint", tool, color: primary, oppositeNatural: input.button === 2 };
    const color = input.button === 2 && tool !== "invert" ? primary === 1 ? 2 : 1 : primary;
    return { kind: "paint", tool, color };
}
