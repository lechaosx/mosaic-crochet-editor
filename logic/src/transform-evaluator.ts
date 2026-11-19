import { centered_transform_placements } from "@mosaic/wasm";

export const MAX_REPEAT_POSITIONS = 4_096;
export const MAX_TRANSFORM_CLAIMS = 1_048_576;

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
    columnSpacingAlternate: number;
    rowSpacingAlternate: number;
    columnOffset: number;
    rowOffset: number;
    columnMirrorHorizontal: boolean;
    columnMirrorVertical: boolean;
    rowMirrorHorizontal: boolean;
    rowMirrorVertical: boolean;
}

export type QuarterTurn = 90 | 180 | 270;

export interface AroundCentreRecipe {
    x: number;
    y: number;
    turns: QuarterTurn[];
    mirrorHorizontal?: boolean;
    mirrorVertical?: boolean;
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
    source: ReadonlyArray<TransformSourceCell>;
    placements: TransformPlacement[];
    columnStep: { x: number; y: number };
    columnStepAlternate: { x: number; y: number };
    rowStep: { x: number; y: number };
    rowStepAlternate: { x: number; y: number };
    cells: EvaluatedTransformCell[];
    conflicts: TransformConflict[];
    instances: EvaluatedTransformCell[][];
}

export interface TransformPlacement {
    map: (cell: TransformSourceCell) => TransformSourceCell;
    unmap: (cell: TransformSourceCell) => TransformSourceCell;
}

export function evaluateCenteredMirrors(
    source: ReadonlyArray<TransformSourceCell>, x: number, y: number, kinds: Uint8Array,
): PackedGridEvaluation {
    const matrices = centered_transform_placements(x, y, kinds);
    const placements: TransformPlacement[] = [];
    for (let i = 0; i < matrices.length; i += 6) {
        const [a, b, c, d, tx, ty] = matrices.slice(i, i + 6);
        placements.push({
            map: cell => ({ x: safeAdd(safeAdd(a * cell.x, b * cell.y), tx),
                y: safeAdd(safeAdd(c * cell.x, d * cell.y), ty) }),
            unmap: cell => {
                const dx = safeSubtract(cell.x, tx), dy = safeSubtract(cell.y, ty);
                return { x: safeAdd(a * dx, c * dy), y: safeAdd(b * dx, d * dy) };
            },
        });
    }
    if (source.length > Math.floor(MAX_TRANSFORM_CLAIMS / placements.length)) {
        throw new RangeError("Selection cannot exceed 1,048,576 transform claims.");
    }
    const claims = new Map<string, CellClaim>();
    const instances = placements.map(placement => source.map((cell, sourceIndex) => {
        const mapped = placement.map(cell);
        addClaim(claims, mapped.x, mapped.y, sourceIndex);
        return { ...mapped, sourceIndex };
    }));
    const ordered = [...claims.values()].sort((a, b) => a.y - b.y || a.x - b.x);
    return { source, placements, instances,
        columnStep: { x: 0, y: 0 }, columnStepAlternate: { x: 0, y: 0 },
        rowStep: { x: 0, y: 0 }, rowStepAlternate: { x: 0, y: 0 },
        cells: ordered.filter(claim => claim.sourceIndices.size === 1).map(claim => ({
            x: claim.x, y: claim.y, sourceIndex: claim.sourceIndices.values().next().value!,
        })),
        conflicts: ordered.filter(claim => claim.sourceIndices.size > 1).map(claim => ({
            x: claim.x, y: claim.y, sourceIndices: [...claim.sourceIndices].sort((a, b) => a - b),
        })),
    };
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
    const columns = safeAdd(safeAdd(recipe.left, recipe.right), 1);
    const rows = safeAdd(safeAdd(recipe.up, recipe.down), 1);
    if (columns > MAX_REPEAT_POSITIONS || rows > MAX_REPEAT_POSITIONS
        || columns * rows > MAX_REPEAT_POSITIONS) {
        throw new RangeError(`Transform grid cannot exceed ${MAX_REPEAT_POSITIONS.toLocaleString("en-US")} positions.`);
    }
    const positions = columns * rows;
    const turns = aroundCentre ? [...new Set(aroundCentre.turns)] : [];
    if (turns.some(turn => turn !== 90 && turn !== 180 && turn !== 270)) {
        throw new RangeError("Rotation supports only quarter turns.");
    }
    const mirrorCopies = Number(aroundCentre?.mirrorHorizontal === true)
        + Number(aroundCentre?.mirrorVertical === true);
    const transformPositions = positions * (turns.length + mirrorCopies + 1);
    if (source.length > Math.floor(MAX_TRANSFORM_CLAIMS / transformPositions)) {
        throw new RangeError(`Transform grid cannot exceed ${MAX_TRANSFORM_CLAIMS.toLocaleString("en-US")} claims.`);
    }
    const spacing = [
        recipe.columnSpacing, recipe.rowSpacing,
        recipe.columnSpacingAlternate, recipe.rowSpacingAlternate,
    ];
    if (spacing.some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError("Grid spacing must be whole numbers that are zero or positive.");
    }
    const offsets = [recipe.columnOffset, recipe.rowOffset];
    if (offsets.some(value => !Number.isSafeInteger(value))) {
        throw new RangeError("Grid offsets must be whole numbers.");
    }
    const mirrors = [recipe.columnMirrorHorizontal, recipe.columnMirrorVertical,
        recipe.rowMirrorHorizontal, recipe.rowMirrorVertical];
    if (mirrors.some(value => typeof value !== "boolean")) {
        throw new RangeError("Grid mirror state must be boolean.");
    }

    const input = expandAroundCentre(source, aroundCentre);
    const columnPacked = packedDistance(input, "x", recipe.columnOffset,
        recipe.columnMirrorHorizontal, recipe.columnMirrorVertical,
        recipe.rowMirrorHorizontal && rows > 1, recipe.rowMirrorVertical && rows > 1);
    const rowPacked = packedDistance(input, "y", recipe.rowOffset,
        recipe.rowMirrorHorizontal, recipe.rowMirrorVertical,
        recipe.columnMirrorHorizontal && columns > 1, recipe.columnMirrorVertical && columns > 1);
    const columnStep = {
        x: safeAdd(columnPacked, recipe.columnSpacing),
        y: recipe.columnOffset,
    };
    const columnStepAlternate = {
        x: safeAdd(columnPacked, recipe.columnSpacingAlternate),
        y: recipe.columnOffset,
    };
    const rowStep = {
        x: recipe.rowOffset,
        y: safeAdd(rowPacked, recipe.rowSpacing),
    };
    const rowStepAlternate = {
        x: recipe.rowOffset,
        y: safeAdd(rowPacked, recipe.rowSpacingAlternate),
    };
    const bounds = cellBounds(input);
    const claims = new Map<string, CellClaim>();
    const instances: EvaluatedTransformCell[][] = [];
    const placements: TransformPlacement[] = [];
    const aroundPlacements = centrePlacements(aroundCentre);

    for (let row = -recipe.up; row <= recipe.down; row++) {
        for (let column = -recipe.left; column <= recipe.right; column++) {
            const dx = safeAdd(
                repeatDistance(column, columnStep.x, columnStepAlternate.x),
                safeMultiply(row, rowStep.x),
            );
            const dy = safeAdd(
                safeMultiply(column, columnStep.y),
                repeatDistance(row, rowStep.y, rowStepAlternate.y),
            );
            const mirrorX = (recipe.columnMirrorHorizontal && isOdd(column))
                !== (recipe.rowMirrorHorizontal && isOdd(row));
            const mirrorY = (recipe.columnMirrorVertical && isOdd(column))
                !== (recipe.rowMirrorVertical && isOdd(row));
            for (const around of aroundPlacements) {
                placements.push({
                    map: cell => {
                        const oriented = orientCell(around.map(cell), bounds, mirrorX, mirrorY);
                        return { x: safeAdd(oriented.x, dx), y: safeAdd(oriented.y, dy) };
                    },
                    unmap: cell => around.unmap(orientCell({
                        x: safeSubtract(cell.x, dx), y: safeSubtract(cell.y, dy),
                    }, bounds, mirrorX, mirrorY)),
                });
            }
            const instanceClaims = new Map<string, CellClaim>();
            for (const cell of input) {
                const oriented = orientCell(cell, bounds, mirrorX, mirrorY);
                for (const sourceIndex of cell.sourceIndices) {
                    addClaim(claims, safeAdd(oriented.x, dx), safeAdd(oriented.y, dy), sourceIndex);
                    addClaim(instanceClaims, safeAdd(oriented.x, dx), safeAdd(oriented.y, dy), sourceIndex);
                }
            }
            instances.push([...instanceClaims.values()]
                .filter(claim => claim.sourceIndices.size === 1)
                .sort((a, b) => a.y - b.y || a.x - b.x)
                .map(claim => ({
                    x: claim.x,
                    y: claim.y,
                    sourceIndex: claim.sourceIndices.values().next().value!,
                })));
        }
    }

    const ordered = [...claims.values()].sort((a, b) => a.y - b.y || a.x - b.x);
    return {
        source,
        placements,
        columnStep,
        columnStepAlternate,
        rowStep,
        rowStepAlternate,
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
        instances,
    };
}

function centrePlacements(centre: AroundCentreRecipe | undefined): TransformPlacement[] {
    const identity = (cell: TransformSourceCell) => ({ ...cell });
    const placements: TransformPlacement[] = [{ map: identity, unmap: identity }];
    if (!centre) return placements;
    for (const turn of [...new Set(centre.turns)]) {
        placements.push({
            map: cell => rotateCell(cell, centre, turn),
            unmap: cell => rotateCell(cell, centre, turn === 90 ? 270 : turn === 270 ? 90 : 180),
        });
    }
    for (const horizontal of [true, false]) {
        if (!(horizontal ? centre.mirrorHorizontal : centre.mirrorVertical)) continue;
        const mirror = (cell: TransformSourceCell) => ({
            x: horizontal ? safeGridSubtract(centre.x * 2, cell.x) : cell.x,
            y: horizontal ? cell.y : safeGridSubtract(centre.y * 2, cell.y),
        });
        placements.push({ map: mirror, unmap: mirror });
    }
    return placements;
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

function expandAroundCentre(
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
    if (turns.length === 0 && !aroundCentre.mirrorHorizontal && !aroundCentre.mirrorVertical) {
        return [...claims.values()];
    }
    if (!isSafeGridCoordinate(aroundCentre.x) || !isSafeGridCoordinate(aroundCentre.y)) {
        throw new RangeError("Rotation centre must be grid-compatible.");
    }
    if (turns.some(turn => turn !== 180)
        && Number.isInteger(aroundCentre.x) !== Number.isInteger(aroundCentre.y)) {
        throw new RangeError("Rotation centre is not grid-compatible with quarter turns.");
    }

    for (const placement of centrePlacements(aroundCentre).slice(1)) {
        source.forEach((cell, sourceIndex) => {
            const mapped = placement.map(cell);
            if (!Number.isSafeInteger(mapped.x) || !Number.isSafeInteger(mapped.y)) {
                throw new RangeError("Rotation centre is not grid-compatible with quarter turns.");
            }
            addClaim(claims, mapped.x, mapped.y, sourceIndex);
        });
    }
    return [...claims.values()];
}

function rotateCell(
    cell: TransformSourceCell,
    centre: Pick<AroundCentreRecipe, "x" | "y">,
    turn: QuarterTurn,
): TransformSourceCell {
    const dx = safeGridSubtract(cell.x, centre.x);
    const dy = safeGridSubtract(cell.y, centre.y);
    if (turn === 90) return {
        x: safeGridSubtract(centre.x, dy),
        y: safeGridAdd(centre.y, dx),
    };
    if (turn === 180) return {
        x: safeGridSubtract(centre.x, dx),
        y: safeGridSubtract(centre.y, dy),
    };
    return {
        x: safeGridAdd(centre.x, dy),
        y: safeGridSubtract(centre.y, dx),
    };
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
        x: mirrorX ? safeAdd(bounds.minX, safeSubtract(bounds.maxX, cell.x)) : cell.x,
        y: mirrorY ? safeAdd(bounds.minY, safeSubtract(bounds.maxY, cell.y)) : cell.y,
    };
}

function isOdd(value: number): boolean {
    return value % 2 !== 0;
}

function repeatDistance(index: number, primary: number, alternate: number): number {
    const magnitude = Math.abs(index);
    const distance = safeAdd(
        safeMultiply(Math.ceil(magnitude / 2), primary),
        safeMultiply(Math.floor(magnitude / 2), alternate),
    );
    return safeMultiply(Math.sign(index), distance);
}

function packedDistance(
    source: ReadonlyArray<TransformSourceCell>,
    primary: "x" | "y",
    crossOffset: number,
    mirrorX: boolean,
    mirrorY: boolean,
    otherMirrorX: boolean,
    otherMirrorY: boolean,
): number {
    const bounds = cellBounds(source);
    const [alongMin, alongMax, acrossMin, acrossMax] = primary === "x"
        ? [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY]
        : [bounds.minY, bounds.maxY, bounds.minX, bounds.maxX];
    const span = safeAdd(safeSubtract(alongMax, alongMin), 1);

    // Each line of cells across the step, as sorted runs [start, end, start, end, …] along it.
    const lines = new Map<number, number[]>();
    for (const cell of source) {
        const across = primary === "x" ? cell.y : cell.x;
        const line = lines.get(across);
        if (line) line.push(primary === "x" ? cell.x : cell.y);
        else lines.set(across, [primary === "x" ? cell.x : cell.y]);
    }
    for (const [across, along] of lines) {
        along.sort((a, b) => a - b);
        const runs: number[] = [];
        for (const value of along) {
            if (runs.length > 0 && runs[runs.length - 1] === value - 1) runs[runs.length - 1] = value;
            else runs.push(value, value);
        }
        lines.set(across, runs);
    }
    const oriented = new Map<string, Map<number, number[]>>();
    const orient = (flipX: boolean, flipY: boolean) => {
        const [flipAlong, flipAcross] = primary === "x" ? [flipX, flipY] : [flipY, flipX];
        const key = `${flipAlong},${flipAcross}`;
        let result = oriented.get(key);
        if (result) return result;
        result = new Map();
        for (const [across, runs] of lines) {
            const flipped: number[] = [];
            if (flipAlong) for (let i = runs.length - 2; i >= 0; i -= 2) {
                flipped.push(alongMin + (alongMax - runs[i + 1]), alongMin + (alongMax - runs[i]));
            }
            result.set(flipAcross ? acrossMin + (acrossMax - across) : across, flipAlong ? flipped : runs);
        }
        oriented.set(key, result);
        return result;
    };
    // A reflected row or column also reverses the cross offset's relation to a sparse motif.
    const pairs: { occupied: Map<number, number[]>; neighbour: Map<number, number[]> }[] = [];
    for (const primaryOdd of [false, true]) {
        for (const otherOdd of [false, true]) {
            const flipX = (mirrorX && primaryOdd) !== (otherMirrorX && otherOdd);
            const flipY = (mirrorY && primaryOdd) !== (otherMirrorY && otherOdd);
            const occupied = orient(flipX, flipY);
            if (!pairs.some(pair => pair.occupied === occupied)) {
                pairs.push({ occupied, neighbour: orient(flipX !== mirrorX, flipY !== mirrorY) });
            }
        }
    }

    // Copies meet on both sides, but the other parity swaps which one is
    // occupied, so testing the following copy of every pair covers both.
    // Each pair of overlapping runs rules out a whole interval of distances, so
    // the search jumps past the furthest one that covers the current distance.
    let distance = 1;
    while (distance <= span) {
        let next = distance;
        for (const { occupied, neighbour } of pairs) {
            for (const [across, runs] of neighbour) {
                const target = occupied.get(across + crossOffset);
                if (!target) continue;
                let i = 0, j = 0;
                while (i < runs.length && j < target.length) {
                    if (runs[i + 1] + distance < target[j]) i += 2;
                    else if (target[j + 1] < runs[i] + distance) j += 2;
                    else {
                        next = Math.max(next, target[j + 1] - runs[i] + 1);
                        if (runs[i + 1] + distance < target[j + 1]) i += 2;
                        else j += 2;
                    }
                }
            }
        }
        if (next === distance) break;
        distance = next;
    }
    const packed = Math.min(distance, span);
    // Reject geometry whose neighbouring copies, at the packed distance and
    // cross offset on either side, would leave safe coordinates.
    safeSubtract(alongMin, packed);
    safeAdd(alongMax, packed);
    for (const across of [acrossMin, acrossMax]) {
        safeSubtract(across, crossOffset);
        safeAdd(across, crossOffset);
    }
    return packed;
}

function safeAdd(a: number, b: number): number {
    const result = a + b;
    if (!Number.isSafeInteger(result)) throw unsafeGeometry();
    return result;
}

function safeSubtract(a: number, b: number): number {
    const result = a - b;
    if (!Number.isSafeInteger(result)) throw unsafeGeometry();
    return result;
}

function safeMultiply(a: number, b: number): number {
    const result = a * b;
    if (!Number.isSafeInteger(result)) throw unsafeGeometry();
    return result;
}

function isSafeGridCoordinate(value: number): boolean {
    return Number.isSafeInteger(value)
        || (Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
            && Math.abs(value % 1) === 0.5);
}

function safeGridAdd(a: number, b: number): number {
    const result = a + b;
    if (!isSafeGridCoordinate(result)) throw unsafeGeometry();
    return result;
}

function safeGridSubtract(a: number, b: number): number {
    const result = a - b;
    if (!isSafeGridCoordinate(result)) throw unsafeGeometry();
    return result;
}

function unsafeGeometry(): RangeError {
    return new RangeError("Transform geometry must stay within safe integer coordinates.");
}
