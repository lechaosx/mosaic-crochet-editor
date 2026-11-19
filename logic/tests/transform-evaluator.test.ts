import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { evaluatePackedGrid, PackedGridRecipe, TransformSourceCell } from "../src/transform-evaluator";

const noGrid: PackedGridRecipe = {
    left: 0,
    right: 0,
    up: 0,
    down: 0,
    columnSpacing: 0,
    rowSpacing: 0,
    columnSpacingAlternate: 0,
    rowSpacingAlternate: 0,
    columnOffset: 0,
    rowOffset: 0,
    columnMirrorHorizontal: false, columnMirrorVertical: false,
    rowMirrorHorizontal: false, rowMirrorVertical: false,
};

describe("packed transform grid prototype", () => {
    test("instance maps preserve an edited offset outside a one-cell source", () => {
        const evaluated = evaluatePackedGrid([{ x: 2, y: 1 }], { ...noGrid, right: 1 },
            { x: 2, y: 2, turns: [90] });
        expect(evaluated.placements.map(instance => instance.map({ x: 2, y: 2 })))
            .toEqual([{ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 2 }]);
        for (const instance of evaluated.placements) {
            expect(instance.unmap(instance.map({ x: 8, y: -3 }))).toEqual({ x: 8, y: -3 });
        }
    });
    test("requires a source and whole-cell grid values", () => {
        expect(() => evaluatePackedGrid([], noGrid)).toThrow(/source/i);
        expect(() => evaluatePackedGrid([{ x: 0.5, y: 0 }], noGrid)).toThrow(/source cells/i);
        expect(() => evaluatePackedGrid([{ x: 0, y: 0 }], { ...noGrid, left: -1 })).toThrow(/counts/i);
        expect(() => evaluatePackedGrid([{ x: 0, y: 0 }], { ...noGrid, right: 4_096 })).toThrow(/4,096/i);
        expect(() => evaluatePackedGrid([{ x: 0, y: 0 }], { ...noGrid, columnSpacing: -1 })).toThrow(/spacing/i);
        expect(() => evaluatePackedGrid([{ x: 0, y: 0 }], { ...noGrid, rowOffset: 0.5 })).toThrow(/offsets/i);
    });

    test("accepts exact safe-coordinate boundaries and rejects unsafe derived steps", () => {
        const max = Number.MAX_SAFE_INTEGER;
        expect(evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            { ...noGrid, right: 1, columnSpacing: max - 1 },
        ).cells.at(-1)).toMatchObject({ x: max, y: 0 });
        expect(() => evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            { ...noGrid, right: 1, columnSpacing: max },
        )).toThrow(/safe integer/i);
    });

    test("rejects unsafe alternating, cross-offset, combined, and final coordinates", () => {
        const max = Number.MAX_SAFE_INTEGER;
        const halfUp = Math.floor(max / 2) + 1;
        expect(() => evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            {
                ...noGrid,
                right: 2,
                columnSpacing: halfUp - 1,
                columnSpacingAlternate: halfUp - 1,
                columnMirrorHorizontal: true,
            },
        )).toThrow(/safe integer/i);
        expect(() => evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            { ...noGrid, right: 2, columnOffset: max },
        )).toThrow(/safe integer/i);
        expect(() => evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            { ...noGrid, right: 1, down: 1, columnSpacing: max - 1, rowOffset: 1 },
        )).toThrow(/safe integer/i);
        expect(() => evaluatePackedGrid(
            [{ x: max, y: 0 }],
            { ...noGrid, right: 1 },
        )).toThrow(/safe integer/i);
    });

    test("accepts at most 1,048,576 source-position claims", () => {
        const source = Array.from({ length: 1_024 }, () => ({ x: 0, y: 0 }));
        expect(() => evaluatePackedGrid(source, { ...noGrid, right: 1_023 })).not.toThrow();
        expect(() => evaluatePackedGrid([...source, { x: 0, y: 0 }], { ...noGrid, right: 1_023 }))
            .toThrow(/1,048,576 claims/i);
    });

    test("counts independently selected rotations before allocating transform claims", () => {
        const source = Array.from({ length: 257 }, () => ({ x: 0, y: 0 }));
        expect(() => evaluatePackedGrid(
            source,
            { ...noGrid, right: 1_023 },
            { x: 0, y: 0, turns: [90, 180, 270] },
        )).toThrow(/1,048,576 claims/i);
    });

    test.each([
        ["horizontal mirror", { mirrorHorizontal: true }, 513],
        ["vertical mirror", { mirrorVertical: true }, 513],
        ["both mirrors", { mirrorHorizontal: true, mirrorVertical: true }, 342],
    ])("counts %s copies before expanding claims", (_label, mirrors, sourceSize) => {
        const source = Array.from({ length: sourceSize }, () => ({ x: 0, y: 0 }));
        expect(() => evaluatePackedGrid(
            source,
            { ...noGrid, right: 1_023 },
            { x: 10, y: 10, turns: [], ...mirrors },
        )).toThrow(/1,048,576 claims/i);
    });

    test.each([
        [{ mirrorHorizontal: true }, 512],
        [{ mirrorVertical: true }, 512],
        [{ mirrorHorizontal: true, mirrorVertical: true }, 341],
    ])("accepts the source boundary for mirror claims", (mirrors, sourceSize) => {
        const source = Array.from({ length: sourceSize }, (_, x) => ({ x, y: 0 }));
        expect(() => evaluatePackedGrid(
            source,
            { ...noGrid, right: 1_023 },
            { x: 100_000, y: 100_000, turns: [], ...mirrors },
        )).not.toThrow();
    });

    test("packs a sparse motif by occupied cells instead of its bounding box", () => {
        const result = evaluatePackedGrid(
            [{ x: 0, y: 0 }, { x: 2, y: 0 }],
            { ...noGrid, right: 1 },
        );

        expect(result.columnStep).toEqual({ x: 1, y: 0 });
        expect(result.cells.map(cell => [cell.x, cell.y])).toEqual([
            [0, 0], [1, 0], [2, 0], [3, 0],
        ]);
        expect(result.conflicts).toEqual([]);
    });

    test("uses independent directional counts, spacing, and cross-axis offsets", () => {
        const result = evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            {
                ...noGrid,
                left: 1,
                right: 2,
                up: 1,
                columnSpacing: 2,
                columnSpacingAlternate: 2,
                rowSpacing: 1,
                rowSpacingAlternate: 1,
                columnOffset: 1,
                rowOffset: 1,
            },
        );

        expect(result.columnStep).toEqual({ x: 3, y: 1 });
        expect(result.rowStep).toEqual({ x: 1, y: 2 });
        expect(result.cells).toHaveLength(8);
        expect(result.cells).toContainEqual({ x: -4, y: -3, sourceIndex: 0 });
        expect(result.cells).toContainEqual({ x: 6, y: 2, sourceIndex: 0 });
    });

    test("re-packs after a cross-axis offset changes", () => {
        const source = [{ x: 0, y: 0 }, { x: 1, y: 0 }];

        expect(evaluatePackedGrid(source, { ...noGrid, right: 1 }).columnStep)
            .toEqual({ x: 2, y: 0 });
        expect(evaluatePackedGrid(source, { ...noGrid, right: 1, columnOffset: 1 }).columnStep)
            .toEqual({ x: 1, y: 1 });
    });

    test("reports collisions introduced only by the combined Cartesian grid", () => {
        const result = evaluatePackedGrid(
            [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            { ...noGrid, right: 1, down: 1 },
        );

        expect(result.columnStep).toEqual({ x: 1, y: 0 });
        expect(result.rowStep).toEqual({ x: 0, y: 1 });
        expect(result.conflicts).toContainEqual({ x: 1, y: 1, sourceIndices: [0, 1] });
    });

    test("deduplicates repeated paths from one source and retains inverse mapping", () => {
        const result = evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            { ...noGrid, right: 1, down: 1, columnOffset: 1, rowOffset: 1 },
        );

        expect(result.conflicts).toEqual([]);
        expect(result.cells).toEqual([
            { x: 0, y: 0, sourceIndex: 0 },
            { x: 1, y: 1, sourceIndex: 0 },
            { x: 2, y: 2, sourceIndex: 0 },
        ]);
    });

    test("includes independently selected exact quarter-turn destinations", () => {
        const result = evaluatePackedGrid(
            [{ x: 1, y: 0 }, { x: 1, y: 1 }],
            noGrid,
            { x: 0, y: 0, turns: [90, 180, 270] },
        );

        expect(result.conflicts).toEqual([]);
        expect(result.cells.map(cell => [cell.x, cell.y])).toEqual([
            [0, -1], [-1, -1], [-1, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1], [1, -1],
        ].sort((a, b) => a[1] - b[1] || a[0] - b[0]));
    });

    test("rejects quarter-turn centres that cannot map cells exactly", () => {
        expect(() => evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            noGrid,
            { x: 0, y: 0.5, turns: [90] },
        )).toThrow(/grid-compatible/i);

        expect(evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            noGrid,
            { x: 0, y: 0.5, turns: [180] },
        ).cells).toEqual([
            { x: 0, y: 0, sourceIndex: 0 },
            { x: 0, y: 1, sourceIndex: 0 },
        ]);
    });

    test("ignores a retained centre while no rotational destination is selected", () => {
        expect(evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            noGrid,
            { x: 0.25, y: 0, turns: [] },
        ).cells).toEqual([{ x: 0, y: 0, sourceIndex: 0 }]);
    });

    test("packs the complete rotational result before applying the grid", () => {
        const result = evaluatePackedGrid(
            [{ x: 0, y: 0 }, { x: 0, y: 1 }],
            { ...noGrid, right: 1 },
            { x: 0, y: 0, turns: [90] },
        );

        expect(result.columnStep).toEqual({ x: 2, y: 0 });
    });

    test("reports multi-source collisions introduced by rotation", () => {
        const result = evaluatePackedGrid(
            [{ x: 1, y: 0 }, { x: 0, y: 1 }],
            noGrid,
            { x: 0, y: 0, turns: [90] },
        );

        expect(result.conflicts).toContainEqual({ x: 0, y: 1, sourceIndices: [0, 1] });
    });

    test("uses signed lattice parity for alternate mirrored columns", () => {
        const result = evaluatePackedGrid(
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
            { ...noGrid, left: 1, right: 2, columnMirrorHorizontal: true },
        );

        expect(result.columnStep).toEqual({ x: 2, y: 0 });
        expect(result.cells).toContainEqual({ x: -1, y: 1, sourceIndex: 2 });
        expect(result.cells).toContainEqual({ x: 3, y: 1, sourceIndex: 2 });
        expect(result.cells).toContainEqual({ x: 4, y: 1, sourceIndex: 2 });
    });

    test("retains unequal legacy gaps for alternating mirrored columns", () => {
        const result = evaluatePackedGrid(
            [{ x: 0, y: 0 }],
            {
                ...noGrid,
                left: 3,
                right: 3,
                columnSpacing: 1,
                columnSpacingAlternate: 3,
                columnOffset: 1,
                columnMirrorHorizontal: true,
            },
        );

        expect(result.columnStep).toEqual({ x: 2, y: 1 });
        expect(result.columnStepAlternate).toEqual({ x: 4, y: 1 });
        expect(result.cells.map(cell => [cell.x, cell.y])).toEqual([
            [-8, -3], [-6, -2], [-2, -1], [0, 0], [2, 1], [6, 2], [8, 3],
        ]);
    });

    test("composes alternate row and column mirrors at odd/odd instances", () => {
        const result = evaluatePackedGrid(
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
            {
                ...noGrid,
                right: 1,
                down: 1,
                columnMirrorHorizontal: true,
                rowMirrorVertical: true,
            },
        );

        expect(result.cells).toContainEqual({ x: 3, y: 3, sourceIndex: 0 });
        expect(result.cells).toContainEqual({ x: 2, y: 3, sourceIndex: 1 });
        expect(result.cells).toContainEqual({ x: 3, y: 2, sourceIndex: 2 });
    });
});


describe("independent grid mirrors", () => {
    const mirrors = { columnMirrorHorizontal: false, columnMirrorVertical: false,
        rowMirrorHorizontal: false, rowMirrorVertical: false };
    const source = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }];
    test.each([
        ["column horizontal", { columnMirrorHorizontal: true }, 1, 0, [2, 0]],
        ["column vertical", { columnMirrorVertical: true }, 1, 0, [0, 1]],
        ["row horizontal", { rowMirrorHorizontal: true }, 0, 1, [2, 0]],
        ["row vertical", { rowMirrorVertical: true }, 0, 1, [0, 1]],
        ["both column mirrors", { columnMirrorHorizontal: true, columnMirrorVertical: true }, 1, 0, [2, 1]],
        ["both row mirrors", { rowMirrorHorizontal: true, rowMirrorVertical: true }, 0, 1, [2, 1]],
        ["same-axis cancellation", { columnMirrorHorizontal: true, rowMirrorHorizontal: true }, 1, 1, [0, 0]],
        ["both-axis cancellation", { columnMirrorHorizontal: true, columnMirrorVertical: true,
            rowMirrorHorizontal: true, rowMirrorVertical: true }, 1, 1, [0, 0]],
    ])("%s composes at signed odd instances", (_name, flags, column, row, expected) => {
        for (const sign of [-1, 1]) {
            const result = evaluatePackedGrid(source, { ...noGrid, ...mirrors, ...flags,
                left: column, right: column, up: row, down: row,
                columnSpacing: 3, columnSpacingAlternate: 3, rowSpacing: 3, rowSpacingAlternate: 3 });
            const dx = sign * column * result.columnStep.x;
            const dy = sign * row * result.rowStep.y;
            expect(result.cells).toContainEqual({ x: dx + expected[0], y: dy + expected[1], sourceIndex: 0 });
        }
    });
    test("re-packs cross offsets for vertical column and horizontal row mirrors", () => {
        const motif = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
        for (const sign of [-1, 1]) {
            expect(evaluatePackedGrid(motif, { ...noGrid, ...mirrors,
                columnMirrorVertical: true, left: 1, right: 1, columnOffset: sign }).columnStep.x).toBe(2);
            expect(evaluatePackedGrid(motif, { ...noGrid, ...mirrors,
                rowMirrorHorizontal: true, up: 1, down: 1, rowOffset: sign }).rowStep.y).toBe(2);
        }
    });
    test("packs sparse reflected neighbours across positive and negative cross offsets", () => {
        const source = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 3, y: 2 }];
        for (const offset of [-1, 1]) {
            for (const flags of [
                { columnMirrorVertical: true },
                { columnMirrorHorizontal: true, columnMirrorVertical: true },
                { columnMirrorHorizontal: true, rowMirrorVertical: true },
            ]) {
                const result = evaluatePackedGrid(source, { ...noGrid, ...mirrors, ...flags,
                    left: 1, right: 1, up: 1, down: 1, columnOffset: offset,
                    rowSpacing: 10, rowSpacingAlternate: 10 });
                expect(result.conflicts).toEqual([]);
            }
        }
    });
    test.each(Object.keys(mirrors))("rejects malformed %s", field => {
        expect(() => evaluatePackedGrid(source, { ...noGrid, ...mirrors, [field]: "true" }))
            .toThrow(/mirror/i);
    });
});


test("unused row mirrors do not change column packing with cross offsets", () => {
    const recipe = { ...noGrid, right: 1, columnOffset: 1 };
    const source = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(evaluatePackedGrid(source, { ...recipe, rowMirrorVertical: true }).columnStep)
        .toEqual(evaluatePackedGrid(source, recipe).columnStep);
});


// The packed step by definition: the smallest distance at which the neighbouring
// copy, in every mirror parity it can meet, shares no cell with this copy on
// either side.
function definedPackedStep(
    cells: TransformSourceCell[], axis: "x" | "y", cross: number,
    own: [boolean, boolean], other: [boolean, boolean],
): number {
    const xs = cells.map(cell => cell.x), ys = cells.map(cell => cell.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const orient = (cell: TransformSourceCell, flipX: boolean, flipY: boolean, dx = 0, dy = 0) =>
        `${(flipX ? minX + maxX - cell.x : cell.x) + dx},${(flipY ? minY + maxY - cell.y : cell.y) + dy}`;
    const span = axis === "x" ? maxX - minX + 1 : maxY - minY + 1;
    for (let distance = 1; distance < span; distance++) {
        const overlaps = [false, true].some(odd => [false, true].some(otherOdd => {
            const flipX = (own[0] && odd) !== (other[0] && otherOdd);
            const flipY = (own[1] && odd) !== (other[1] && otherOdd);
            const occupied = new Set(cells.map(cell => orient(cell, flipX, flipY)));
            return [-1, 1].some(direction => cells.some(cell => occupied.has(axis === "x"
                ? orient(cell, flipX !== own[0], flipY !== own[1], direction * distance, direction * cross)
                : orient(cell, flipX !== own[0], flipY !== own[1], direction * cross, direction * distance))));
        }));
        if (!overlaps) return distance;
    }
    return span;
}

describe("packed steps", () => {
    const motif = fc.record({
        width: fc.integer({ min: 1, max: 12 }), height: fc.integer({ min: 1, max: 12 }),
        x: fc.integer({ min: -20, max: 20 }), y: fc.integer({ min: -20, max: 20 }),
        density: fc.constantFrom(0.15, 0.5, 0.9, 1),
        seed: fc.integer(),
    }).map(({ width, height, x, y, density, seed }) => {
        let state = seed >>> 0;
        const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32;
        const cells: TransformSourceCell[] = [];
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
            if (random() < density) cells.push({ x: x + column, y: y + row });
        }
        return cells.length > 0 ? cells : [{ x, y }];
    });
    const recipe = fc.record({
        left: fc.integer({ min: 0, max: 1 }), right: fc.integer({ min: 0, max: 1 }),
        up: fc.integer({ min: 0, max: 1 }), down: fc.integer({ min: 0, max: 1 }),
        columnSpacing: fc.integer({ min: 0, max: 2 }), rowSpacing: fc.integer({ min: 0, max: 2 }),
        columnSpacingAlternate: fc.integer({ min: 0, max: 2 }), rowSpacingAlternate: fc.integer({ min: 0, max: 2 }),
        columnOffset: fc.integer({ min: -14, max: 14 }), rowOffset: fc.integer({ min: -14, max: 14 }),
        columnMirrorHorizontal: fc.boolean(), columnMirrorVertical: fc.boolean(),
        rowMirrorHorizontal: fc.boolean(), rowMirrorVertical: fc.boolean(),
    });
    const around = fc.option(fc.record({
        x: fc.integer({ min: -8, max: 8 }), y: fc.integer({ min: -8, max: 8 }),
        turns: fc.subarray([90, 180, 270] as const), mirrorHorizontal: fc.boolean(), mirrorVertical: fc.boolean(),
    }), { nil: undefined });

    test("equal the defined packing of the complete motif, sparse or dense", () => {
        fc.assert(fc.property(motif, recipe, around, (source, grid, centre) => {
            const expanded = evaluatePackedGrid(source, noGrid, centre);
            const cells = [...expanded.cells, ...expanded.conflicts];
            const columns = grid.left + grid.right + 1 > 1, rows = grid.up + grid.down + 1 > 1;
            const result = evaluatePackedGrid(source, grid, centre);
            expect(result.columnStep.x).toBe(grid.columnSpacing + definedPackedStep(cells, "x", grid.columnOffset,
                [grid.columnMirrorHorizontal, grid.columnMirrorVertical],
                [grid.rowMirrorHorizontal && rows, grid.rowMirrorVertical && rows]));
            expect(result.rowStep.y).toBe(grid.rowSpacing + definedPackedStep(cells, "y", grid.rowOffset,
                [grid.rowMirrorHorizontal, grid.rowMirrorVertical],
                [grid.columnMirrorHorizontal && columns, grid.columnMirrorVertical && columns]));
        }), { numRuns: 500 });
    });

    test("reject unsafe packing geometry even without copies", () => {
        const max = Number.MAX_SAFE_INTEGER;
        expect(() => evaluatePackedGrid([{ x: max, y: 0 }], noGrid)).toThrow(/safe integer/i);
        expect(() => evaluatePackedGrid([{ x: 0, y: -max }], noGrid)).toThrow(/safe integer/i);
        expect(() => evaluatePackedGrid([{ x: 0, y: 1 }], { ...noGrid, columnOffset: max })).toThrow(/safe integer/i);
        expect(() => evaluatePackedGrid([{ x: 1, y: 0 }], { ...noGrid, rowOffset: -max })).toThrow(/safe integer/i);
        expect(evaluatePackedGrid([{ x: max - 1, y: 0 }, { x: max - 3, y: 0 }], noGrid).columnStep.x).toBe(1);
    });
});
