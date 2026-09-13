import { evaluatePackedGrid, PackedGridRecipe } from "./transform-evaluator";
import { patternDimensionError } from "./pattern";
import { PatternState, RoundState } from "./types";

export type OutputPreset = "as-authored" | "rotate-quarter-to-full";

export interface CompositionClaim {
    x: number;
    y: number;
    sourceIndices: number[];
}

export interface ComposedOutput {
    status: "ready" | "conflict";
    pattern: PatternState;
    pixels: Uint8Array;
    sourceIndices: Int32Array;
    sharedCells: CompositionClaim[];
    conflicts: CompositionClaim[];
}

export interface UnavailableOutput {
    status: "unavailable";
    reason: string;
}

export type OutputComposition = ComposedOutput | UnavailableOutput;

const noGrid: PackedGridRecipe = {
    left: 0,
    right: 0,
    up: 0,
    down: 0,
    columnSpacing: 0,
    rowSpacing: 0,
    columnOffset: 0,
    rowOffset: 0,
    columnOrientation: "same",
    rowOrientation: "same",
};

export function composeOutput(
    pattern: PatternState,
    pixels: Uint8Array,
    preset: OutputPreset,
): OutputComposition {
    const sourceError = patternDimensionError(pattern);
    if (sourceError) return { status: "unavailable", reason: sourceError };
    if (pixels.length !== pattern.canvasWidth * pattern.canvasHeight) {
        throw new RangeError("Pixel buffer does not match the source canvas.");
    }
    if (preset === "as-authored") return asAuthored(pattern, pixels);
    return rotateQuarterToFull(pattern, pixels);
}

function asAuthored(pattern: PatternState, pixels: Uint8Array): ComposedOutput {
    const sourceIndices = new Int32Array(pixels.length).fill(-1);
    for (let index = 0; index < pixels.length; index++) {
        if (pixels[index] !== 0) sourceIndices[index] = index;
    }
    return {
        status: "ready",
        pattern: { ...pattern },
        pixels: pixels.slice(),
        sourceIndices,
        sharedCells: [],
        conflicts: [],
    };
}

function rotateQuarterToFull(pattern: PatternState, pixels: Uint8Array): OutputComposition {
    if (pattern.mode !== "round"
        || pattern.offsetX !== 0
        || pattern.offsetY !== pattern.rounds
        || pattern.canvasWidth !== pattern.virtualWidth - pattern.rounds
        || pattern.canvasHeight !== pattern.virtualHeight - pattern.rounds) {
        return { status: "unavailable", reason: "Rotate to full requires an authored quarter." };
    }
    if (pattern.virtualWidth !== pattern.virtualHeight) {
        return { status: "unavailable", reason: "Quarter-turn output requires square virtual geometry." };
    }

    const outputPattern: RoundState = {
        mode: "round",
        canvasWidth: pattern.virtualWidth,
        canvasHeight: pattern.virtualHeight,
        virtualWidth: pattern.virtualWidth,
        virtualHeight: pattern.virtualHeight,
        offsetX: 0,
        offsetY: 0,
        rounds: pattern.rounds,
    };
    const outputError = patternDimensionError(outputPattern);
    if (outputError) return { status: "unavailable", reason: outputError };

    const cells: { x: number; y: number }[] = [];
    const occupiedSourceIndices: number[] = [];
    for (let index = 0; index < pixels.length; index++) {
        if (pixels[index] === 0) continue;
        cells.push({
            x: index % pattern.canvasWidth + pattern.offsetX,
            y: Math.floor(index / pattern.canvasWidth) + pattern.offsetY,
        });
        occupiedSourceIndices.push(index);
    }
    if (cells.length === 0) {
        return { status: "unavailable", reason: "The authored quarter contains no work cells." };
    }

    const centre = (pattern.virtualWidth - 1) / 2;
    const evaluated = evaluatePackedGrid(cells, noGrid, {
        x: centre,
        y: centre,
        turns: [90, 180, 270],
    });
    const outputPixels = new Uint8Array(outputPattern.canvasWidth * outputPattern.canvasHeight);
    const sourceIndices = new Int32Array(outputPixels.length).fill(-1);
    const sharedCells: CompositionClaim[] = [];
    const conflicts: CompositionClaim[] = [];

    for (const cell of evaluated.cells) {
        const sourceIndex = occupiedSourceIndices[cell.sourceIndex];
        if (!claimPreservesRound(pattern, sourceIndex, cell.x, cell.y)) {
            return { status: "unavailable", reason: "The composition changes the source yarn phase." };
        }
        const targetIndex = cell.y * outputPattern.canvasWidth + cell.x;
        outputPixels[targetIndex] = pixels[sourceIndex];
        sourceIndices[targetIndex] = sourceIndex;
    }
    for (const cell of evaluated.conflicts) {
        const claims = cell.sourceIndices.map(index => occupiedSourceIndices[index]);
        if (claims.some(sourceIndex => !claimPreservesRound(pattern, sourceIndex, cell.x, cell.y))) {
            return { status: "unavailable", reason: "The composition changes the source yarn phase." };
        }
        const targetIndex = cell.y * outputPattern.canvasWidth + cell.x;
        const colors = new Set(claims.map(sourceIndex => pixels[sourceIndex]));
        outputPixels[targetIndex] = pixels[claims[0]];
        sourceIndices[targetIndex] = claims[0];
        const claim = { x: cell.x, y: cell.y, sourceIndices: claims };
        if (colors.size === 1) sharedCells.push(claim);
        else conflicts.push(claim);
    }

    for (let y = 0; y < outputPattern.canvasHeight; y++) {
        for (let x = 0; x < outputPattern.canvasWidth; x++) {
            const paintable = roundDepth(x, y, outputPattern.canvasWidth, outputPattern.canvasHeight)
                < outputPattern.rounds;
            if (paintable !== (outputPixels[y * outputPattern.canvasWidth + x] !== 0)) {
                return { status: "unavailable", reason: "The authored quarter does not cover the full output." };
            }
        }
    }

    return {
        status: conflicts.length === 0 ? "ready" : "conflict",
        pattern: outputPattern,
        pixels: outputPixels,
        sourceIndices,
        sharedCells,
        conflicts,
    };
}

function claimPreservesRound(pattern: RoundState, sourceIndex: number, x: number, y: number): boolean {
    const sourceX = sourceIndex % pattern.canvasWidth + pattern.offsetX;
    const sourceY = Math.floor(sourceIndex / pattern.canvasWidth) + pattern.offsetY;
    return roundDepth(sourceX, sourceY, pattern.virtualWidth, pattern.virtualHeight)
        === roundDepth(x, y, pattern.virtualWidth, pattern.virtualHeight);
}

function roundDepth(x: number, y: number, width: number, height: number): number {
    return Math.min(x, y, width - 1 - x, height - 1 - y);
}
