// The Rust highlight plan of the visible pixels, kept up to date by
// recomputing only the cells an edit can affect.

import { PlanCell, highlight_plan_counts, highlight_plan_reach, highlight_plan_round, highlight_plan_row } from "@mosaic/wasm";
import type { PatternState } from "./types";

export interface CellRect {
    x:      number;
    y:      number;
    width:  number;
    height: number;
}

// One `PlanCell` byte per canvas cell, row-major, with the counts the editor shows.
export interface HighlightPlan {
    readonly cells:   Uint8Array;
    readonly marked:  number;   // cells with a glyph
    readonly invalid: number;   // cells whose glyph is a warning
}

export interface MutableHighlightPlan extends HighlightPlan {
    marked:  number;
    invalid: number;
}

const REACH = highlight_plan_reach();

function wholeCanvas(pattern: PatternState): CellRect {
    return { x: 0, y: 0, width: pattern.canvasWidth, height: pattern.canvasHeight };
}

// `rect` grown by `by` cells on every side, clipped to the canvas.
function growRect(rect: CellRect, by: number, pattern: PatternState): CellRect {
    const x = Math.max(0, rect.x - by), y = Math.max(0, rect.y - by);
    return {
        x, y,
        width:  Math.min(pattern.canvasWidth, rect.x + rect.width + by) - x,
        height: Math.min(pattern.canvasHeight, rect.y + rect.height + by) - y,
    };
}

function planCells(pattern: PatternState, visible: Uint8Array, rect: CellRect): Uint8Array {
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const window = growRect(rect, REACH, pattern);
    let pixels = visible.subarray(window.y * W, (window.y + window.height) * W);
    if (window.width !== W) {
        pixels = new Uint8Array(window.width * window.height);
        for (let y = 0; y < window.height; y++) {
            const start = (window.y + y) * W + window.x;
            pixels.set(visible.subarray(start, start + window.width), y * window.width);
        }
    }
    return pattern.mode === "row"
        ? highlight_plan_row(pixels, window.x, window.y, window.width, W, H,
            rect.x, rect.y, rect.width, rect.height)
        : highlight_plan_round(pixels, window.x, window.y, window.width, W, H,
            pattern.virtualWidth, pattern.virtualHeight, pattern.offsetX, pattern.offsetY, pattern.rounds,
            rect.x, rect.y, rect.width, rect.height);
}

export function computeHighlightPlan(pattern: PatternState, visible: Uint8Array): MutableHighlightPlan {
    const cells = planCells(pattern, visible, wholeCanvas(pattern));
    // Counted in wasm: run once over a large chart, a JS loop is as fast as
    // whichever tier V8 has compiled it to by then, at worst over ten times slower.
    const [marked, invalid] = highlight_plan_counts(cells);
    return { cells, marked, invalid };
}

// Recomputes the plan of the cells within reach of `changed`, which holds
// every cell whose visible pixel changed, and returns that region.
export function updateHighlightPlan(
    plan: MutableHighlightPlan, pattern: PatternState, visible: Uint8Array, changed: CellRect,
): CellRect {
    const region = growRect(changed, REACH, pattern);
    const next = planCells(pattern, visible, region);
    const { cells } = plan;
    let { marked, invalid } = plan;
    for (let y = 0; y < region.height; y++) {
        const row = (region.y + y) * pattern.canvasWidth + region.x;
        for (let x = 0; x < region.width; x++) {
            const before = cells[row + x], after = next[y * region.width + x];
            marked  += (after === 0 ? 0 : 1) - (before === 0 ? 0 : 1);
            invalid += (after & PlanCell.Invalid ? 1 : 0) - (before & PlanCell.Invalid ? 1 : 0);
            cells[row + x] = after;
        }
    }
    plan.marked = marked;
    plan.invalid = invalid;
    return region;
}

// The smallest rectangle holding every cell that differs between two
// pixel arrays of a `width`-cell-wide canvas; null when none does.
export function changedCells(before: Uint8Array, after: Uint8Array, width: number): CellRect | null {
    let first = -1, last = -1, minX = width, maxX = -1;
    const differs = (index: number) => {
        if (first < 0) first = index;
        last = index;
        const x = index % width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    };
    let index = 0;
    // Four cells per comparison where alignment allows: this scan covers the
    // whole canvas on every stroke step.
    if (before.byteOffset % 4 === 0 && after.byteOffset % 4 === 0) {
        const words = before.length >> 2;
        const before32 = new Uint32Array(before.buffer, before.byteOffset, words);
        const after32 = new Uint32Array(after.buffer, after.byteOffset, words);
        for (let word = 0; word < words; word++) {
            if (before32[word] === after32[word]) continue;
            for (let i = word * 4; i < word * 4 + 4; i++) if (before[i] !== after[i]) differs(i);
        }
        index = words * 4;
    }
    for (; index < before.length; index++) if (before[index] !== after[index]) differs(index);
    if (first < 0) return null;
    const top = Math.floor(first / width);
    return { x: minX, y: top, width: maxX - minX + 1, height: Math.floor(last / width) - top + 1 };
}
