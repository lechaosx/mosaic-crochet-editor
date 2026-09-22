// @vitest-environment jsdom
// localStorage IO tests — pure pack/unpack tests live in logic/tests/storage.test.ts.

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { saveToLocalStorage, loadFromLocalStorage, saveToFile, loadFromFile } from "../src/storage-io";
import { rowSession, filledPixels, makeFloat } from "./_helpers";
import { addAxis } from "@mosaic/logic/symmetry";
import { encodeMcw } from "@mosaic/logic/mcw";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";

beforeEach(() => { localStorage.clear(); });

describe("saveToLocalStorage / loadFromLocalStorage", () => {
    test("reports a failed recovery write without throwing", () => {
        const originalSetItem = Storage.prototype.setItem;
        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
            if (key === "mosaic-recovery") throw new DOMException("full", "QuotaExceededError");
            return originalSetItem.call(this, key, value);
        });

        try {
            expect(saveToLocalStorage(rowSession(3, 3))).toBe(false);
        } finally {
            setItem.mockRestore();
        }
    });

    test("round-trip preserves all serialised session fields", () => {
        const s = rowSession(3, 3, {
            colorA: "#11ff22",
            colorB: "#abcdef",
            activeTool: "fill",
            primaryColor: 2,
            axes: addAxis(addAxis([], "V", 3, 3), "H", 3, 3),
            recipes: [gridRecipeFromFloat(makeFloat([{ x: 0, y: 0, v: 1 }]))],
            rotation: 90,
            pixels: filledPixels(3, 3, 2),
            float: makeFloat([{ x: 2, y: 0, v: 1 }]),
        });
        saveToLocalStorage(s);
        const loaded = loadFromLocalStorage();
        expect(loaded).not.toBeNull();
        expect(loaded!.colorA).toBe("#11ff22");
        expect(loaded!.activeTool).toBe("fill");
        expect(loaded!.primaryColor).toBe(2);
        expect(loaded!.axes).toHaveLength(2);
        expect(loaded!.axes.find(a => a.kind === "V")!.active).toBe(true);
        expect(loaded!.axes.find(a => a.kind === "H")!.active).toBe(true);
        expect(loaded!.recipes).toEqual(s.recipes);
        expect(loaded!.rotation).toBe(90);
        expect(loaded!.pixels[0]).toBe(2);
        expect(loaded!.float).not.toBeNull();
        expect(loaded!.float!.x).toBe(2);
        expect(loaded!.float!.y).toBe(0);
        expect(loaded!.float!.pixels[0]).toBe(1);
    });

    test("nothing in localStorage → null", () => {
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("wrong version → null even with otherwise-valid payload", () => {
        const valid = rowSession(3, 3);
        saveToLocalStorage(valid);
        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        raw.version = 999;
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("saved sessions without recipes migrate to no saved repeats", () => {
        saveToLocalStorage(rowSession(3, 3));
        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        delete raw.workspace.recipes;
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));

        expect(loadFromLocalStorage()!.recipes).toEqual([]);
    });

    test("recovery defaults optional v3 recipe extensions", () => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 1 }]));
        recipe.columnSpacing = 2;
        recipe.rowSpacing = 3;
        saveToLocalStorage(rowSession(3, 3, { recipes: [recipe] }));
        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        const stored = raw.workspace.recipes[0];
        delete stored.mode;
        delete stored.columnSpacingAlternate;
        delete stored.rowSpacingAlternate;
        delete stored.rotationCentreX;
        delete stored.rotationCentreY;
        delete stored.rotationTurns;
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));

        expect(loadFromLocalStorage()!.recipes[0]).toMatchObject({
            mode: "grid",
            columnSpacingAlternate: 2,
            rowSpacingAlternate: 3,
            rotationCentreX: 1,
            rotationCentreY: 1,
            rotationTurns: [],
        });
    });

    test.each([
        ["grid", { mode: "rotation", left: -1 }],
        ["rotation", { mode: "grid", rotationCentreX: 0.25 }],
    ])("recovery drops a recipe with malformed retained %s settings", (_field, malformed) => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 1 }]));
        saveToLocalStorage(rowSession(3, 3, { recipes: [recipe] }));
        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        Object.assign(raw.workspace.recipes[0], malformed);
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));

        expect(loadFromLocalStorage()!.recipes).toEqual([]);
    });

    test("recovery clears an active recipe whose float does not match its source", () => {
        const source = makeFloat([{ x: 0, y: 0, v: 1 }]);
        const recipe = gridRecipeFromFloat(source);
        saveToLocalStorage(rowSession(3, 3, {
            recipes: [recipe],
            activeRecipeId: recipe.id,
            float: makeFloat([{ x: 1, y: 0, v: 1 }]),
        }));

        expect(loadFromLocalStorage()!.activeRecipeId).toBeNull();
    });

    test("global mirror mode round-trips and defaults on for older sessions", () => {
        const session = rowSession(3, 3, { liveMirrors: false });
        saveToLocalStorage(session);

        const loaded = loadFromLocalStorage();
        expect(loaded!.liveMirrors).toBe(false);

        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        delete raw.workspace.liveTransforms;
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));
        const migrated = loadFromLocalStorage();
        expect(migrated!.liveMirrors).toBe(true);
    });

    test("current recovery drops stale axes before the restored project can save", () => {
        const valid = { id: "valid", kind: "V" as const, active: false, x: 1 };
        const stale = { id: "stale", kind: "H" as const, active: true, y: 0 };
        saveToLocalStorage(rowSession(3, 3, { axes: [valid, stale] }));

        const restored = loadFromLocalStorage()!;
        expect(restored.axes).toEqual([valid]);
        expect(() => encodeMcw(restored)).not.toThrow();
    });

    test("missing state → null", () => {
        localStorage.setItem("mosaic-recovery", JSON.stringify({ version: 5 }));
        expect(loadFromLocalStorage()).toBeNull();
    });

    test("malformed JSON → null and clears the bad blob", () => {
        localStorage.setItem("mosaic-recovery", "{not json");
        expect(loadFromLocalStorage()).toBeNull();
        expect(localStorage.getItem("mosaic-recovery")).toBeNull();
    });

    test("oversized saved dimensions are rejected before pixel allocation", () => {
        const valid = rowSession(3, 3);
        saveToLocalStorage(valid);
        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        raw.document.state.canvasWidth = 1_048_577;
        raw.document.state.canvasHeight = 1;
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));

        expect(loadFromLocalStorage()).toBeNull();
        expect(localStorage.getItem("mosaic-recovery")).toBeNull();
    });

    test("non-square canvas with float round-trips correctly", () => {
        const f = makeFloat([{ x: 3, y: 1, v: 2 }]);
        const s = rowSession(4, 2, { pixels: filledPixels(4, 2, 1), float: f });
        saveToLocalStorage(s);
        const loaded = loadFromLocalStorage();
        expect(loaded).not.toBeNull();
        expect(loaded!.float!.x).toBe(3);
        expect(loaded!.float!.y).toBe(1);
        expect(loaded!.float!.pixels[0]).toBe(2);
    });
});

describe("saveToFile", () => {
    afterEach(() => {
        delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    });

    test("returns false when the file picker is cancelled", async () => {
        Object.assign(window, {
            showSaveFilePicker: () => Promise.reject(new DOMException("cancelled", "AbortError")),
        });

        await expect(saveToFile(rowSession(3, 3))).resolves.toBe(false);
    });

    test("propagates file picker failures", async () => {
        Object.assign(window, {
            showSaveFilePicker: () => Promise.reject(new Error("Disk full.")),
        });

        await expect(saveToFile(rowSession(3, 3))).rejects.toThrow("Disk full.");
    });

    test("writes only project fields, including global mirror axes", async () => {
        let written = "";
        Object.assign(window, {
            showSaveFilePicker: async () => ({
                createWritable: async () => ({
                    write: async (source: string) => { written = source; },
                    close: async () => {},
                }),
            }),
        });
        const session = rowSession(3, 3, {
            axes: addAxis([], "V", 3, 3),
            recipes: [gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 2 }]))],
            activeTool: "move",
            rotation: 45,
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
        });

        await expect(saveToFile(session)).resolves.toBe(true);
        const file = JSON.parse(written);
        expect(file).toMatchObject({ version: 3, axes: session.axes });
        expect(file.recipes).toHaveLength(1);
        expect(file).not.toHaveProperty("activeTool");
        expect(file).not.toHaveProperty("rotation");
        expect(file).not.toHaveProperty("float");
    });
});

describe("loadFromFile", () => {
    afterEach(() => vi.restoreAllMocks());

    test("rejects when the selected file cannot be read", async () => {
        vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function () {
            Object.defineProperty(this, "files", {
                value: [new File(["{}"], "pattern.mcw", { type: "application/json" })],
            });
            this.dispatchEvent(new Event("change"));
        });
        vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function () {
            this.onerror?.(new ProgressEvent("error"));
        });

        const outcome = await Promise.race([
            loadFromFile().then(
                () => "resolved",
                error => error instanceof Error ? error.message : "rejected",
            ),
            new Promise<string>(resolve => setTimeout(() => resolve("pending"), 0)),
        ]);

        expect(outcome).toBe("Could not read pattern file.");
    });
});
