import {
    fill_region, paint_natural_row, paint_natural_round,
    paint_overlay_row, paint_overlay_round, clear_overlay_row, clear_overlay_round,
    overlay_target_available_row, overlay_target_available_round,
    overlay_inward_cell_row, overlay_inward_cell_round, transformed_patch_targets,
} from "@mosaic/wasm";
import { PatternState } from "./types";
import { MAX_TRANSFORM_CLAIMS, type PackedGridEvaluation, type TransformPlacement, type TransformSourceCell } from "./transform-evaluator";

export type PaintTool = "pencil" | "fill" | "eraser" | "overlay" | "invert";
export type OverlayAction = "place" | "clear" | "invert";

export interface PaintCtx {
    visible:        Uint8Array;
    pattern:        PatternState;
    x:              number;
    y:              number;
    color:          1 | 2;
    primary:        1 | 2;
    overlayAction?: OverlayAction;
    invertVisited:  Set<number> | null;
    transforms:     Float64Array;
    shifted:        Uint8Array | null;
    repeat?:        PackedGridEvaluation | null;
}

const none = new Float64Array(0);
const identity: TransformPlacement = { map: cell => cell, unmap: cell => cell };

function paint(tool: PaintTool, c: PaintCtx): Uint8Array {
    const { visible, pattern: p, x, y, color, primary, transforms, shifted, repeat } = c;
    const W = p.canvasWidth, H = p.canvasHeight;
    const inCanvas = (cell: TransformSourceCell) => cell.x >= 0 && cell.x < W && cell.y >= 0 && cell.y < H;
    const index = (cell: TransformSourceCell) => cell.y * W + cell.x;
    const click = { x, y };
    if (inCanvas(click) && (visible[index(click)] === 0 || shifted?.[index(click)] === 0)) return visible.slice();
    if (!inCanvas(click) && tool !== "overlay") return visible.slice();
    if (repeat?.conflicts.some(cell => cell.x === x && cell.y === y)) throw new RangeError("Repeat has conflicting source cells.");
    const clicked = repeat?.cells.find(cell => cell.x === x && cell.y === y);
    const candidates = clicked && repeat ? repeat.placements.filter(placement => {
        const mapped = placement.map(repeat.source[clicked.sourceIndex]);
        return mapped.x === x && mapped.y === y;
    }) : [identity];
    const sourcePlacement = candidates[0];
    const placements = clicked && repeat ? repeat.placements : [identity];
    const toggling = tool === "invert" || (tool === "overlay" && c.overlayAction === "invert");
    let sourceCells: TransformSourceCell[];
    let result = visible;
    if (tool === "fill") {
        let sourceMask = shifted;
        if (clicked && repeat) {
            sourceMask = new Uint8Array(visible.length);
            for (const cell of repeat.source) {
                const mapped = sourcePlacement.map(cell);
                if (inCanvas(mapped) && (!shifted || shifted[index(mapped)] !== 0)) sourceMask[index(mapped)] = 1;
            }
        }
        const region = fill_region(visible, W, H, x, y, sourceMask);
        sourceCells = [];
        for (let i = 0; i < region.length; i += 2) sourceCells.push({ x: region[i], y: region[i + 1] });
    } else if (tool === "overlay") {
        const support = p.mode === "row"
            ? overlay_inward_cell_row(W, H, x, y)
            : overlay_inward_cell_round(W, H, p.virtualWidth, p.virtualHeight, p.offsetX, p.offsetY, x, y);
        if (support.length === 0) return visible.slice();
        sourceCells = [{ x: support[0], y: support[1] }];
        if (visible[index(sourceCells[0])] === 0) return visible.slice();
        const apply = (clear: boolean) => p.mode === "row"
            ? (clear ? clear_overlay_row : paint_overlay_row)(visible, W, H, x, y, none)
            : (clear ? clear_overlay_round : paint_overlay_round)(visible, W, H, p.virtualWidth, p.virtualHeight, p.offsetX, p.offsetY, p.rounds, x, y, none);
        let action = c.overlayAction ?? "place";
        if (action === "invert") {
            const cleared = apply(true);
            const present = cleared[index(sourceCells[0])] !== visible[index(sourceCells[0])];
            const available = p.mode === "row" ? overlay_target_available_row(W, H, x, y)
                : overlay_target_available_round(W, H, p.virtualWidth, p.virtualHeight, p.offsetX, p.offsetY, p.rounds, x, y);
            if (!present && !available) return visible.slice();
            action = present ? "clear" : "place";
        }
        if (action === "place" && !inCanvas(click)) return visible.slice();
        result = apply(action === "clear");
    } else {
        sourceCells = [click];
        if (tool === "eraser") result = p.mode === "row"
            ? paint_natural_row(visible, W, H, x, y, none, color !== primary, null)
            : paint_natural_round(visible, W, H, p.virtualWidth, p.virtualHeight, p.offsetX, p.offsetY, p.rounds, x, y, none, color !== primary, null);
    }
    if (toggling && sourceCells.some(cell => c.invertVisited?.has(index(cell)))) return visible.slice();

    const writes = new Map<number, number>();
    const visited = new Set<number>();
    let claimCount = 0;
    for (const sourceCell of sourceCells) {
        const value = tool === "pencil" || tool === "fill" ? color
            : tool === "invert" ? (visible[index(sourceCell)] === 1 ? 2 : 1)
                : result[index(sourceCell)];
        const canonical = sourcePlacement.unmap(sourceCell);
        // A shared anchor can belong to several orientations; its edited support must identify one.
        if (clicked && repeat && (repeat.source[clicked.sourceIndex].x !== x || repeat.source[clicked.sourceIndex].y !== y)) {
            for (const candidate of candidates) {
                const other = candidate.unmap(sourceCell);
                if (other.x !== canonical.x || other.y !== canonical.y) throw new RangeError("Repeat edit has ambiguous orientation.");
            }
        }
        for (const placement of placements) {
            const target = placement.map(canonical);
            const anchor = tool === "overlay" && inCanvas(click) ? placement.map(sourcePlacement.unmap(click)) : target;
            if (!inCanvas(anchor)) continue;
            if (target.x < -2_147_483_648 || target.x > 2_147_483_647
                || target.y < -2_147_483_648 || target.y > 2_147_483_647) continue;
            const orbit = transformed_patch_targets(W, H, anchor.x, anchor.y, target.x, target.y, transforms);
            if (orbit.length === 0) throw new RangeError("Transform exceeds its safety limit.");
            claimCount += orbit.length / 4;
            if (claimCount > MAX_TRANSFORM_CLAIMS) throw new RangeError("Paint cannot exceed 1,048,576 transform claims.");
            for (let i = 0; i < orbit.length; i += 4) {
                const authorized = { x: orbit[i], y: orbit[i + 1] };
                const dest = { x: orbit[i + 2], y: orbit[i + 3] };
                if (!inCanvas(authorized)) continue;
                if (inCanvas(authorized) && shifted?.[index(authorized)] === 0) continue;
                if (!inCanvas(dest) || visible[index(dest)] === 0) continue;
                const destIndex = index(dest);
                if (writes.has(destIndex) && writes.get(destIndex) !== value) throw new RangeError("Paint transforms have conflicting results.");
                writes.set(destIndex, value);
                visited.add(destIndex);
            }
        }
    }
    if (toggling && [...visited].some(i => c.invertVisited?.has(i))) return visible.slice();
    const out = visible.slice();
    for (const [i, value] of writes) out[i] = value;
    if (toggling) for (const i of visited) c.invertVisited?.add(i);
    return out;
}

export const paintOps: Record<PaintTool, (c: PaintCtx) => Uint8Array> = {
    pencil: c => paint("pencil", c),
    fill: c => paint("fill", c),
    eraser: c => paint("eraser", c),
    overlay: c => paint("overlay", c),
    invert: c => paint("invert", c),
};
