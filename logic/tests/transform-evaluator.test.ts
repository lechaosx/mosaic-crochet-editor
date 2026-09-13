import { describe, expect, test } from "vitest";
import { evaluatePackedGrid, PackedGridRecipe } from "../src/transform-evaluator";

const noGrid: PackedGridRecipe = {
    left: 0,
    right: 0,
    up: 0,
    down: 0,
    columnSpacing: 0,
    rowSpacing: 0,
    columnOffset: 0,
    rowOffset: 0,
};

describe("packed transform grid prototype", () => {
    test("requires a source and whole-cell grid values", () => {
        expect(() => evaluatePackedGrid([], noGrid)).toThrow(/source/i);
        expect(() => evaluatePackedGrid([{ x: 0, y: 0 }], { ...noGrid, left: -1 })).toThrow(/counts/i);
        expect(() => evaluatePackedGrid([{ x: 0, y: 0 }], { ...noGrid, columnSpacing: -1 })).toThrow(/spacing/i);
        expect(() => evaluatePackedGrid([{ x: 0, y: 0 }], { ...noGrid, rowOffset: 0.5 })).toThrow(/offsets/i);
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
                rowSpacing: 1,
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
});
