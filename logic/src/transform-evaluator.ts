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
): PackedGridEvaluation {
    if (source.length === 0) throw new RangeError("Transform source must contain at least one cell.");
    const counts = [recipe.left, recipe.right, recipe.up, recipe.down];
    if (counts.some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError("Grid counts must be whole numbers that are zero or positive.");
    }
    const spacing = [recipe.columnSpacing, recipe.rowSpacing];
    if (spacing.some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError("Grid spacing must be whole numbers that are zero or positive.");
    }
    const offsets = [recipe.columnOffset, recipe.rowOffset];
    if (offsets.some(value => !Number.isSafeInteger(value))) {
        throw new RangeError("Grid offsets must be whole numbers.");
    }

    const columnStep = {
        x: packedDistance(source, "x", recipe.columnOffset) + recipe.columnSpacing,
        y: recipe.columnOffset,
    };
    const rowStep = {
        x: recipe.rowOffset,
        y: packedDistance(source, "y", recipe.rowOffset) + recipe.rowSpacing,
    };
    const claims = new Map<string, { x: number; y: number; sourceIndices: Set<number> }>();

    for (let row = -recipe.up; row <= recipe.down; row++) {
        for (let column = -recipe.left; column <= recipe.right; column++) {
            const dx = column * columnStep.x + row * rowStep.x;
            const dy = column * columnStep.y + row * rowStep.y;
            for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex++) {
                const x = source[sourceIndex].x + dx;
                const y = source[sourceIndex].y + dy;
                const key = coordKey(x, y);
                const claim = claims.get(key);
                if (claim) claim.sourceIndices.add(sourceIndex);
                else claims.set(key, { x, y, sourceIndices: new Set([sourceIndex]) });
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

function coordKey(x: number, y: number): string {
    return `${x},${y}`;
}

function packedDistance(
    source: ReadonlyArray<TransformSourceCell>,
    primary: "x" | "y",
    crossOffset: number,
): number {
    const occupied = new Set(source.map(cell => coordKey(cell.x, cell.y)));
    const values = source.map(cell => cell[primary]);
    const span = Math.max(...values) - Math.min(...values) + 1;

    for (let distance = 1; distance <= span; distance++) {
        const overlaps = source.some(cell => {
            const x = cell.x + (primary === "x" ? distance : crossOffset);
            const y = cell.y + (primary === "y" ? distance : crossOffset);
            return occupied.has(coordKey(x, y));
        });
        if (!overlaps) return distance;
    }
    return span;
}
