// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";
import { recipeInstancePaths, selectionTransformHandles } from "../src/render";

test("Grid grips reference visible left/up neighbour centres and keep a touch-sized separation", () => {
    const recipe = gridRecipeFromFloat({ x: 4, y: 4, w: 2, h: 2, pixels: new Uint8Array(4).fill(1) });
    recipe.left = 1; recipe.up = 1;
    const handles = selectionTransformHandles(recipe, 40, 0);
    expect(handles[0].x - handles[0].offsetX).toBe(3);
    expect(handles[0].y - handles[0].offsetY).toBe(5);
    expect(handles[1].x - handles[1].offsetX).toBe(5);
    expect(handles[1].y - handles[1].offsetY).toBe(3);
    recipe.columnOffset = 2; recipe.rowOffset = 2; recipe.right = 1; recipe.down = 1;
    const close = selectionTransformHandles(recipe, 10, 45);
    expect(Math.hypot(close[0].x - close[1].x, close[0].y - close[1].y) * 10).toBeGreaterThanOrEqual(44);
});

test("staggered Grid grips stay outside both source and neighbour bounds", () => {
    const recipe = gridRecipeFromFloat({ x: 4, y: 4, w: 2, h: 2, pixels: new Uint8Array(4).fill(1) });
    recipe.right = 1; recipe.down = 1;
    recipe.columnOffset = 2; recipe.rowOffset = -2;
    const [column, row] = selectionTransformHandles(recipe, 40, 0);
    expect(column.y).toBeLessThan(4);
    expect(column.y).toBeLessThan(column.y - column.offsetY - 1);
    expect(row.x).toBeGreaterThan(6);
    expect(row.x).toBeGreaterThan(row.x - row.offsetX + 1);
});

describe("repeat instance outlines", () => {
    test("represent many instances sparsely on a large canvas", () => {
        const width = 1_000_000;
        const pixels = new Uint8Array(width).fill(1);
        const recipe = gridRecipeFromFloat({
            x: 10, y: 0, w: 1, h: 1, pixels: new Uint8Array([1]),
        });
        recipe.right = 1_000;

        const paths = recipeInstancePaths(
            { mode: "row", canvasWidth: width, canvasHeight: 1 },
            pixels,
            recipe,
        );

        expect(paths).toHaveLength(1_000);
        expect(paths.every(instance => instance.length === 1 && instance[0].length === 10)).toBe(true);
        expect(paths.flat(2)).toHaveLength(10_000);
    });

    test("clips instance cells at canvas bounds and holes", () => {
        const pixels = new Uint8Array([1, 0, 1, 1]);
        const recipe = gridRecipeFromFloat({
            x: 0, y: 0, w: 1, h: 1, pixels: new Uint8Array([1]),
        });
        recipe.left = 1;
        recipe.right = 3;

        const paths = recipeInstancePaths(
            { mode: "row", canvasWidth: 4, canvasHeight: 1 },
            pixels,
            recipe,
        );

        expect(paths).toHaveLength(2);
        expect(paths.flat(2)).toHaveLength(20);
    });

    test("keeps diagonally touching components as complete separate loops", () => {
        const pixels = new Uint8Array(12).fill(1);
        const recipe = gridRecipeFromFloat({
            x: 0, y: 0, w: 2, h: 2, pixels: new Uint8Array([1, 0, 0, 1]),
        });
        recipe.right = 1;

        const paths = recipeInstancePaths(
            { mode: "row", canvasWidth: 6, canvasHeight: 2 },
            pixels,
            recipe,
        );

        expect(paths).toHaveLength(1);
        expect(paths[0]).toHaveLength(2);
        expect(paths[0].every(path => path.length === 10)).toBe(true);
    });
});
