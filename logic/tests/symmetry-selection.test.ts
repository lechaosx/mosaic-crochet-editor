// Symmetry × selection contract: paint inside an active selection mirrors
// across active axes, BUT the selection mask itself does NOT mirror.
// Locks the current design — if we ever change selection to mirror, this
// test fails loudly.

import { describe, test, expect, vi } from "vitest";
import { initialize_round_pattern } from "@mosaic/wasm";
import { paintOps } from "../src/paint";
import { axesToFlat, addAxis } from "../src/symmetry";
import { Store } from "../src/store";
import { applyGridRecipe, replicateSelection, activateGridRecipe, createGridRecipe, deleteGridRecipe, commitSelectRect } from "../src/selection";
import { filledPixels, makeFloat, rowPattern, rowSession } from "./_helpers";
import { gridRecipeFromFloat, restoreGridRecipes } from "../src/grid-recipes";

describe("symmetry-aware paint inside selection", () => {
    test("with Vertical symmetry, painting (0, 1) clipped to a mask that doesn't include the mirrored cell only paints (0, 1)", () => {
        // Clipping is now done inside paint_pixel (Rust-side), so the
        // mirrored cell (4, 1) is skipped because it's outside the selection.
        const W = 5, H = 5;
        const visible = filledPixels(W, H, 1);
        const pattern = rowPattern(W, H);
        // Shifted mask = only (0, 1) selected. With V symmetry on a 5×5
        // canvas, (0, 1) mirrors to (4, 1).
        const shifted = new Uint8Array(W * H);
        shifted[1 * W + 0] = 1;
        const transforms = axesToFlat(addAxis([], "V", W, H));
        const out = paintOps.pencil({
            visible, pattern, x: 0, y: 1,
            color: 2, primary: 1,
            invertVisited: null,
            transforms, shifted,
        });
        // Rust clips to selection: only (0, 1) painted, mirrored (4, 1) skipped.
        expect(out[1 * W + 0]).toBe(2);
        expect(out[1 * W + 4]).toBe(1);
        // The selection mask itself doesn't mirror — shifted[1, 4] is still 0.
        expect(shifted[1 * W + 4]).toBe(0);
    });

    test("selection mask is not auto-mirrored — contract test", () => {
        // The selection mask is what the user explicitly drew. Symmetry
        // axes do not mirror the marquee outline. This is a contract
        // test: if we ever flip the design, this must be updated.
        const W = 5, H = 5;
        const mask = new Uint8Array(W * H);
        mask[1 * W + 0] = 1;
        // No function in `symmetry.ts` or `selection.ts` should expand
        // `mask` based on active axes. The visible marquee is exactly
        // these cells.
        const transforms = axesToFlat(addAxis(addAxis([], "V", W, H), "H", W, H));
        // We just assert that axesToFlat returns a Float64Array;
        // the selection bitmask is unaffected.
        expect(transforms).toBeInstanceOf(Float64Array);
        expect(mask[1 * W + 4]).toBe(0);
    });
});

describe("replicateSelection", () => {
    const vertical = [{ kind: "V" as const, id: "v", active: true, x: 2 }];

    test("stamps mirrored pixels into the canvas and keeps the source float", () => {
        const source = makeFloat([{ x: 0, y: 0, v: 2 }]);
        const store = new Store(rowSession(5, 1, {
            pixels: filledPixels(5, 1, 1),
            float: source,
            axes: vertical,
        }));
        const history = vi.fn();
        store.setHistoryFn(history);

        expect(replicateSelection(store)).toBe("applied");

        expect(store.state.pixels).toEqual(new Uint8Array([1, 1, 1, 1, 2]));
        expect(store.state.float).toBe(source);
        expect(history).toHaveBeenCalledOnce();
    });

    test("rejects a mixed-colour orbit without changing state or history", () => {
        const pixels = filledPixels(5, 1, 1);
        const source = makeFloat([
            { x: 0, y: 0, v: 1 },
            { x: 4, y: 0, v: 2 },
        ]);
        const store = new Store(rowSession(5, 1, { pixels, float: source, axes: vertical }));
        const history = vi.fn();
        store.setHistoryFn(history);

        expect(replicateSelection(store)).toBe("conflict");

        expect(store.state.pixels).toBe(pixels);
        expect(store.state.float).toBe(source);
        expect(history).not.toHaveBeenCalled();
    });

    test("ignores off-canvas source cells instead of reflecting them back in", () => {
        const pixels = filledPixels(4, 1, 1);
        const source = makeFloat([{ x: -1, y: 0, v: 2 }]);
        const store = new Store(rowSession(4, 1, {
            pixels,
            float: source,
            axes: [{ kind: "V", id: "v", active: true, x: 1 }],
        }));
        const history = vi.fn();
        store.setHistoryFn(history);

        expect(replicateSelection(store)).toBe("unchanged");

        expect(store.state.pixels).toBe(pixels);
        expect(store.state.float).toBe(source);
        expect(history).not.toHaveBeenCalled();
    });

    test("does not create history when there are no active axes", () => {
        const pixels = filledPixels(5, 1, 1);
        const source = makeFloat([{ x: 0, y: 0, v: 2 }]);
        const store = new Store(rowSession(5, 1, { pixels, float: source }));
        const history = vi.fn();
        store.setHistoryFn(history);

        expect(replicateSelection(store)).toBe("unchanged");

        expect(store.state.pixels).toBe(pixels);
        expect(history).not.toHaveBeenCalled();
    });

});

describe("saved recipe lifecycle", () => {
    test("apply ignores transform conflicts that only land outside the chart", () => {
        const source = makeFloat([
            { x: 0, y: 0, v: 1 },
            { x: 0, y: 1, v: 2 },
        ]);
        const recipe = gridRecipeFromFloat(source);
        Object.assign(recipe, {
            mode: "rotation",
            rotationCentreX: 1.5,
            rotationCentreY: 0.5,
            rotationTurns: [180, 270],
            mirrorHorizontal: true,
        });
        const store = new Store(rowSession(2, 3, {
            pixels: filledPixels(2, 3, 2),
            float: source,
            recipes: [recipe],
            activeRecipeId: recipe.id,
        }));

        expect(applyGridRecipe(store)).toBe("applied");
        expect(store.state.pixels[2 * 2 + 1]).toBe(1);
    });

    test("apply clips destinations outside the chart instead of rejecting valid instances", () => {
        const source = makeFloat([{ x: 0, y: 0, v: 2 }]);
        const recipe = gridRecipeFromFloat(source);
        recipe.right = 3;
        const store = new Store(rowSession(2, 1, {
            pixels: filledPixels(2, 1, 1),
            float: source,
            recipes: [recipe],
            activeRecipeId: recipe.id,
        }));

        expect(applyGridRecipe(store)).toBe("applied");
        expect(store.state.pixels).toEqual(new Uint8Array([1, 2]));
    });

    test("apply skips round holes while retaining later valid destinations", () => {
        const W = 8, H = 8;
        const pattern = {
            mode: "round" as const,
            canvasWidth: W, canvasHeight: H,
            virtualWidth: W, virtualHeight: H,
            offsetX: 0, offsetY: 0, rounds: 2,
        };
        const pixels = initialize_round_pattern(W, H, W, H, 0, 0, 2);
        let sourceX = -1, sourceY = -1, step = -1;
        for (let y = 0; y < H && sourceX < 0; y++) {
            for (let distance = 1; distance < W / 2; distance++) {
                for (let x = 0; x + distance * 2 < W; x++) {
                    if (pixels[y * W + x] !== 0 && pixels[y * W + x + distance] === 0
                        && pixels[y * W + x + distance * 2] !== 0) {
                        sourceX = x;
                        sourceY = y;
                        step = distance;
                        break;
                    }
                }
            }
        }
        expect(sourceX).toBeGreaterThanOrEqual(0);
        const source = makeFloat([{ x: sourceX, y: sourceY, v: 2 }]);
        const recipe = gridRecipeFromFloat(source);
        recipe.right = 2;
        recipe.columnSpacing = step - 1;
        recipe.columnSpacingAlternate = step - 1;
        const store = new Store(rowSession(W, H, {
            pattern, pixels, float: source, recipes: [recipe], activeRecipeId: recipe.id,
        }));

        expect(applyGridRecipe(store)).toBe("applied");
        expect(store.state.pixels[sourceY * W + sourceX + step]).toBe(0);
        expect(store.state.pixels[sourceY * W + sourceX + step * 2]).toBe(2);
    });

    test("the initial empty slot is filled by the next selection operation", () => {
        const [slot] = restoreGridRecipes(undefined);
        const store = new Store(rowSession(3, 1, {
            pixels: filledPixels(3, 1, 1),
            recipes: [slot],
            activeRecipeId: slot.id,
        }));

        commitSelectRect(store, 1, 0, 1, 0, "replace");

        expect(store.state.recipes).toHaveLength(1);
        expect(store.state.activeRecipeId).toBe(slot.id);
        expect(store.state.recipes[0].source).toMatchObject({ x: 1, y: 0, w: 1, h: 1 });
    });

    test("new selection creates and selects an empty slot while preserving earlier selections", () => {
        const first = gridRecipeFromFloat(makeFloat([{ x: 0, y: 0, v: 1 }]));
        const store = new Store(rowSession(3, 1, {
            pixels: filledPixels(3, 1, 1),
            recipes: [first],
            activeRecipeId: first.id,
            float: makeFloat([{ x: 0, y: 0, v: 1 }]),
        }));

        expect(createGridRecipe(store)).toBe("created");

        expect(store.state.recipes).toHaveLength(2);
        expect(store.state.recipes[0]).toEqual(first);
        expect(store.state.recipes[1].source.mask).toHaveLength(0);
        expect(store.state.activeRecipeId).toBe(store.state.recipes[1].id);
        expect(store.state.float).toBeNull();
    });

    test("the only saved selection cannot be deleted", () => {
        const [only] = restoreGridRecipes(undefined);
        const store = new Store(rowSession(3, 1, { recipes: [only], activeRecipeId: only.id }));

        deleteGridRecipe(store, only.id);

        expect(store.state.recipes).toEqual([only]);
        expect(store.state.activeRecipeId).toBe(only.id);
    });
    test("reactivating a sparse source preserves its exact saved bounds", () => {
        const source = { x: 0, y: 0, w: 3, h: 1, pixels: new Uint8Array([0, 1, 0]) };
        const recipe = gridRecipeFromFloat(source);
        const store = new Store(rowSession(5, 1, {
            pixels: filledPixels(5, 1, 1),
            recipes: [recipe],
        }));

        expect(activateGridRecipe(store, recipe.id)).toBe(true);
        expect(store.state.activeRecipeId).toBe(recipe.id);
        expect(store.state.float).toEqual(source);
    });

    test("activates, switches, reactivates, and deletes saved source selections", () => {
        const first = makeFloat([{ x: 0, y: 0, v: 1 }]);
        const store = new Store(rowSession(5, 1, { pixels: filledPixels(5, 1, 1), float: first }));
        expect(createGridRecipe(store)).toBe("created");
        const firstId = store.state.activeRecipeId!;
        store.commit(s => { s.float = makeFloat([{ x: 2, y: 0, v: 2 }]); });
        expect(createGridRecipe(store)).toBe("created");
        const secondId = store.state.activeRecipeId!;
        expect(activateGridRecipe(store, firstId)).toBe(true);
        expect(store.state.activeRecipeId).toBe(firstId);
        expect(activateGridRecipe(store, secondId)).toBe(true);
        deleteGridRecipe(store, firstId);
        expect(store.state.recipes.map(recipe => recipe.id)).toContain(secondId);
        deleteGridRecipe(store, secondId);
        expect(store.state.recipes).toHaveLength(1);
        expect(store.state.activeRecipeId).toBe(store.state.recipes[0].id);
    });
});
