// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";
import { recipeInstancePaths } from "../src/render";

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
