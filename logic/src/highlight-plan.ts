// The Rust highlight plan of the visible pixels.

import { PlanCell, highlight_plan_round, highlight_plan_row } from "@mosaic/wasm";
import type { PatternState } from "./types";

// One `PlanCell` byte per canvas cell, row-major, with the counts the editor shows.
export interface HighlightPlan {
    readonly cells:   Uint8Array;
    readonly marked:  number;   // cells with a glyph
    readonly invalid: number;   // cells whose glyph is a warning
}

export function computeHighlightPlan(pattern: PatternState, visible: Uint8Array): HighlightPlan {
    const cells = pattern.mode === "row"
        ? highlight_plan_row(visible, pattern.canvasWidth, pattern.canvasHeight)
        : highlight_plan_round(
            visible, pattern.canvasWidth, pattern.canvasHeight,
            pattern.virtualWidth, pattern.virtualHeight,
            pattern.offsetX, pattern.offsetY, pattern.rounds,
        );
    let marked = 0, invalid = 0;
    for (let i = 0; i < cells.length; i++) {
        marked  += cells[i] === 0 ? 0 : 1;
        invalid += cells[i] & PlanCell.Invalid ? 1 : 0;
    }
    return { cells, marked, invalid };
}
