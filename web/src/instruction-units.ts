import {
    instruction_start_round, instruction_start_row, InstructionSession, InstructionUnitKind, InstructionYarn,
} from "@mosaic/wasm";
import {
    changedCells, computeHighlightPlan, updateHighlightPlan, type MutableHighlightPlan,
} from "@mosaic/logic/highlight-plan";
import type { PatternState } from "@mosaic/logic/types";
import type { CachedInstructionUnit, InstructionUnitSignature } from "./instruction-cache";

// What an instruction worker is asked: first the chart, then units by index,
// or previews if it was started for them. A unit whose stitches match
// `knownContentKey` is answered with its signature alone, for the caller to
// reuse its cached text.
export type InstructionRequest =
    | { kind: "start"; pattern: PatternState; pixels: Uint8Array; previews: boolean }
    | { kind: "unit"; index: number; knownContentKey: string | null }
    | { kind: "preview"; completedUnits: number | null };

export type InstructionReply =
    | { index: number; unit: CachedInstructionUnit }
    | { index: number; signature: InstructionUnitSignature }
    | { error: string };

// The chart as Crochet shows it with `completedUnits` worked, or whole for
// null, and the plan of those pixels.
export interface InstructionPreview {
    pixels: Uint8Array;
    plan:   MutableHighlightPlan;
}

export type PreviewReply = { preview: InstructionPreview } | { error: string };

export function startInstructions(pattern: PatternState, pixels: Uint8Array): InstructionSession {
    const { canvasWidth: W, canvasHeight: H } = pattern;
    if (pattern.mode === "row") return instruction_start_row(pixels, W, H);
    const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = pattern;
    return instruction_start_round(pixels, W, H, vw, vh, ox, oy, rounds);
}

export function instructionReply(
    session: InstructionSession, index: number, knownContentKey: string | null,
): InstructionReply {
    const raw = session.signature_at(index)!;
    const signature: InstructionUnitSignature = {
        label: `${raw.kind() === InstructionUnitKind.Row ? "Row" : "Round"} ${raw.number()}`,
        yarn: raw.yarn() === InstructionYarn.A ? "A" : "B",
        contentKey: raw.content_key(),
        invalidWorkedCoords: raw.invalid_worked_coords(),
        startDirection: raw.start_direction(),
        reversedStartDirection: raw.reversed_start_direction(),
    };
    raw.free();
    if (signature.contentKey === knownContentKey) return { index, signature };
    const unit = session.unit_at(index)!;
    const reply = { index, unit: {
        ...signature,
        text: unit.text(), reversedText: unit.reversed_text(),
        workedCoords: unit.worked_coords(), reversedWorkedCoords: unit.reversed_worked_coords(),
        invalid: signature.invalidWorkedCoords.length > 0,
    } };
    unit.free();
    return reply;
}

// The preview of `completedUnits` for the chart `pixels` of `session`. Its plan
// is `previous`'s, updated in place where the pixels differ.
export function nextPreview(
    session: InstructionSession, pattern: PatternState, pixels: Uint8Array,
    previous: InstructionPreview | null, completedUnits: number | null,
): InstructionPreview {
    const next = completedUnits === null ? pixels : session.wip_pixels(completedUnits);
    if (!previous) return { pixels: next, plan: computeHighlightPlan(pattern, next) };
    const changed = changedCells(previous.pixels, next, pattern.canvasWidth);
    if (changed) updateHighlightPlan(previous.plan, pattern, next, changed);
    return { pixels: next, plan: previous.plan };
}
