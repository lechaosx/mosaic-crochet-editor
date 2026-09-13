import { MAX_REPEAT_POSITIONS } from "./repeat";

export interface TransformSourceCell {
    x: number;
    y: number;
}

export interface PackedGridRecipe {
    left: number;
    right: number;
    up: number;
    down: number;
    columnSpacing: number;
    rowSpacing: number;
    columnOffset: number;
    rowOffset: number;
    columnOrientation: GridOrientation;
    rowOrientation: GridOrientation;
}

export type GridOrientation = "same" | "alternate-mirrored";
export type QuarterTurn = 90 | 180 | 270;

export interface AroundCentreRecipe {
    x: number;
    y: number;
    turns: QuarterTurn[];
}

export interface EvaluatedTransformCell {
    x: number;
    y: number;
    sourceIndex: number;
}

export interface TransformConflict {
    x: number;
    y: number;
    sourceIndices: number[];
}

export interface PackedGridEvaluation {
    columnStep: { x: number; y: number };
    rowStep: { x: number; y: number };
    cells: EvaluatedTransformCell[];
    conflicts: TransformConflict[];
}

export function evaluatePackedGrid(
    source: ReadonlyArray<TransformSourceCell>,
    recipe: PackedGridRecipe,
    aroundCentre?: AroundCentreRecipe,
): PackedGridEvaluation {
    if (source.length === 0) throw new RangeError("Transform source must contain at least one cell.");
    if (source.some(cell => !Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y))) {
        throw new RangeError("Transform source cells must use whole coordinates.");
    }
    const counts = [recipe.left, recipe.right, recipe.up, recipe.down];
    if (counts.some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError("Grid counts must be whole numbers that are zero or positive.");
    }
    const columns = recipe.left + recipe.right + 1;
    const rows = recipe.up + recipe.down + 1;
    if (columns > MAX_REPEAT_POSITIONS || rows > MAX_REPEAT_POSITIONS
        || columns * rows > MAX_REPEAT_POSITIONS) {
        throw new RangeError(`Transform grid cannot exceed ${MAX_REPEAT_POSITIONS.toLocaleString("en-US")} positions.`);
    }
    const spacing = [recipe.columnSpacing, recipe.rowSpacing];
    if (spacing.some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError("Grid spacing must be whole numbers that are zero or positive.");
    }
    const offsets = [recipe.columnOffset, recipe.rowOffset];
    if (offsets.some(value => !Number.isSafeInteger(value))) {
        throw new RangeError("Grid offsets must be whole numbers.");
    }
    const orientations = [recipe.columnOrientation, recipe.rowOrientation];
    if (orientations.some(value => value !== "same" && value !== "alternate-mirrored")) {
        throw new RangeError("Grid orientation is not supported.");
    }

    const input = expandQuarterTurns(source, aroundCentre);

    const columnStep = {
        x: packedDistance(
            input, "x", recipe.columnOffset,
            recipe.columnOrientation === "alternate-mirrored",
        ) + recipe.columnSpacing,
        y: recipe.columnOffset,
    };
    const rowStep = {
        x: recipe.rowOffset,
        y: packedDistance(
            input, "y", recipe.rowOffset,
            recipe.rowOrientation === "alternate-mirrored",
        ) + recipe.rowSpacing,
    };
    const bounds = cellBounds(input);
    const claims = new Map<string, CellClaim>();

    for (let row = -recipe.up; row <= recipe.down; row++) {
        for (let column = -recipe.left; column <= recipe.right; column++) {
            const dx = column * columnStep.x + row * rowStep.x;
            const dy = column * columnStep.y + row * rowStep.y;
            const mirrorX = recipe.columnOrientation === "alternate-mirrored" && isOdd(column);
            const mirrorY = recipe.rowOrientation === "alternate-mirrored" && isOdd(row);
            for (const cell of input) {
                const oriented = orientCell(cell, bounds, mirrorX, mirrorY);
                for (const sourceIndex of cell.sourceIndices) {
                    addClaim(claims, oriented.x + dx, oriented.y + dy, sourceIndex);
                }
            }
        }
    }

    const ordered = [...claims.values()].sort((a, b) => a.y - b.y || a.x - b.x);
    return {
        columnStep,
        rowStep,
        cells: ordered
            .filter(claim => claim.sourceIndices.size === 1)
            .map(claim => ({
                x: claim.x,
                y: claim.y,
                sourceIndex: claim.sourceIndices.values().next().value!,
            })),
        conflicts: ordered
            .filter(claim => claim.sourceIndices.size > 1)
            .map(claim => ({
                x: claim.x,
                y: claim.y,
                sourceIndices: [...claim.sourceIndices].sort((a, b) => a - b),
            })),
    };
}

interface CellClaim {
    x: number;
    y: number;
    sourceIndices: Set<number>;
}

interface CellBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

function coordKey(x: number, y: number): string {
    return `${x},${y}`;
}

function addClaim(claims: Map<string, CellClaim>, x: number, y: number, sourceIndex: number): void {
    const key = coordKey(x, y);
    const claim = claims.get(key);
    if (claim) claim.sourceIndices.add(sourceIndex);
    else claims.set(key, { x, y, sourceIndices: new Set([sourceIndex]) });
}

function expandQuarterTurns(
    source: ReadonlyArray<TransformSourceCell>,
    aroundCentre: AroundCentreRecipe | undefined,
): CellClaim[] {
    const claims = new Map<string, CellClaim>();
    source.forEach((cell, sourceIndex) => addClaim(claims, cell.x, cell.y, sourceIndex));
    if (!aroundCentre) return [...claims.values()];

    const turns = [...new Set(aroundCentre.turns)];
    if (turns.some(turn => turn !== 90 && turn !== 180 && turn !== 270)) {
        throw new RangeError("Rotation supports only quarter turns.");
    }
    if (turns.length === 0) return [...claims.values()];
    if (!Number.isSafeInteger(aroundCentre.x * 2) || !Number.isSafeInteger(aroundCentre.y * 2)) {
        throw new RangeError("Rotation centre must be grid-compatible.");
    }
    if (turns.some(turn => turn !== 180)
        && Number.isInteger(aroundCentre.x) !== Number.isInteger(aroundCentre.y)) {
        throw new RangeError("Rotation centre is not grid-compatible with quarter turns.");
    }

    source.forEach((cell, sourceIndex) => {
        for (const turn of turns) {
            const rotated = rotateCell(cell, aroundCentre, turn);
            if (!Number.isSafeInteger(rotated.x) || !Number.isSafeInteger(rotated.y)) {
                throw new RangeError("Rotation centre is not grid-compatible with quarter turns.");
            }
            addClaim(claims, rotated.x, rotated.y, sourceIndex);
        }
    });
    return [...claims.values()];
}

function rotateCell(
    cell: TransformSourceCell,
    centre: Pick<AroundCentreRecipe, "x" | "y">,
    turn: QuarterTurn,
): TransformSourceCell {
    const dx = cell.x - centre.x;
    const dy = cell.y - centre.y;
    if (turn === 90) return { x: centre.x - dy, y: centre.y + dx };
    if (turn === 180) return { x: centre.x - dx, y: centre.y - dy };
    return { x: centre.x + dy, y: centre.y - dx };
}

function cellBounds(source: ReadonlyArray<TransformSourceCell>): CellBounds {
    let minX = source[0].x;
    let maxX = source[0].x;
    let minY = source[0].y;
    let maxY = source[0].y;
    for (let i = 1; i < source.length; i++) {
        const cell = source[i];
        minX = Math.min(minX, cell.x);
        maxX = Math.max(maxX, cell.x);
        minY = Math.min(minY, cell.y);
        maxY = Math.max(maxY, cell.y);
    }
    return { minX, maxX, minY, maxY };
}

function orientCell(
    cell: TransformSourceCell,
    bounds: CellBounds,
    mirrorX: boolean,
    mirrorY: boolean,
): TransformSourceCell {
    return {
        x: mirrorX ? bounds.minX + bounds.maxX - cell.x : cell.x,
        y: mirrorY ? bounds.minY + bounds.maxY - cell.y : cell.y,
    };
}

function isOdd(value: number): boolean {
    return value % 2 !== 0;
}

function packedDistance(
    source: ReadonlyArray<TransformSourceCell>,
    primary: "x" | "y",
    crossOffset: number,
    alternateMirrored: boolean,
): number {
    const occupied = new Set<string>();
    for (const cell of source) occupied.add(coordKey(cell.x, cell.y));
    const bounds = cellBounds(source);
    const span = primary === "x"
        ? bounds.maxX - bounds.minX + 1
        : bounds.maxY - bounds.minY + 1;

    for (let distance = 1; distance <= span; distance++) {
        const overlaps = [-1, 1].some(direction => source.some(cell => {
            const oriented = orientCell(
                cell,
                bounds,
                alternateMirrored && primary === "x",
                alternateMirrored && primary === "y",
            );
            const x = oriented.x + direction * (primary === "x" ? distance : crossOffset);
            const y = oriented.y + direction * (primary === "y" ? distance : crossOffset);
            return occupied.has(coordKey(x, y));
        }));
        if (!overlaps) return distance;
    }
    return span;
}
