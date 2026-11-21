import {
    instruction_start_round, instruction_start_row, InstructionSession, InstructionUnitKind, InstructionYarn,
} from "@mosaic/wasm";
import type { PatternState } from "@mosaic/logic/types";
import type { CachedInstructionUnit, InstructionUnitSignature } from "./instruction-cache";

// What an instruction worker is asked: first the chart, then units by index.
// A unit whose stitches match `knownContentKey` is answered with its signature
// alone, for the caller to reuse its cached text.
export type InstructionRequest =
    | { kind: "start"; pattern: PatternState; pixels: Uint8Array }
    | { kind: "unit"; index: number; knownContentKey: string | null };

export type InstructionReply =
    | { index: number; unit: CachedInstructionUnit }
    | { index: number; signature: InstructionUnitSignature }
    | { error: string };

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
