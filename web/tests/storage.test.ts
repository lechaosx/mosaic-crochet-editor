// @vitest-environment jsdom
// localStorage IO tests — pure pack/unpack tests live in logic/tests/storage.test.ts.

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { saveToLocalStorage, loadFromLocalStorage, saveToFile, loadFromFile } from "../src/storage-io";
import { rowSession, filledPixels, makeFloat } from "./_helpers";
import { addMirror } from "@mosaic/logic/symmetry";
import { encodeMcw } from "@mosaic/logic/mcw";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";
import { contrastingProjectColors } from "../src/contrast-colors";

beforeEach(() => { localStorage.clear(); });

describe("saveToLocalStorage / loadFromLocalStorage", () => {
    test("chosen tool variants are recovered independently of authored content", () => {
        const toolVariants = { select: "add", wand: "remove", move: "duplicate", overlay: "clear" } as const;
        const session = rowSession(3, 3, { toolVariants });
        expect(saveToLocalStorage(session)).toBe(true);
        expect(loadFromLocalStorage()).toMatchObject({ toolVariants });
        const recovered = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        expect(recovered.version).toBe(8);
        expect(recovered.workspace.toolVariants).toEqual(toolVariants);
        expect(recovered.document.toolVariants).toBeUndefined();
    });

    test.each([4, 5, 6])("recovery v%s defaults remembered variants without changing content", version => {
        const session = rowSession(3, 3);
        saveToLocalStorage(session);
        const current = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        const preferences = { hlOpacity: 30, labelsVisible: true, lockInvalid: false, canvasRotation: 90 };
        const older = version === 4 ? {
            version, state: current.document.state, pixels: current.document.pixels,
            colorA: session.colorA, colorB: session.colorB, activeTool: "wand", primaryColor: 2,
            axes: [], float: null, ...preferences,
        } : { ...current, version, preferences };
        if (version !== 4) delete older.workspace.toolVariants;
        localStorage.setItem("mosaic-recovery", JSON.stringify(older));
        const restored = loadFromLocalStorage()!;
        expect(restored.toolVariants).toEqual({ select: "replace", wand: "replace", move: "move", overlay: "place" });
        expect(restored.pixels).toEqual(session.pixels);
        expect(restored.pattern).toEqual(session.pattern);
        expect(JSON.parse(localStorage.getItem("mosaic-recovery")!).version).toBe(8);
    });
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
            mirrors: addMirror(addMirror([], "V", { mode: "row", canvasWidth: 3, canvasHeight: 3 }), "H", { mode: "row", canvasWidth: 3, canvasHeight: 3 }),
            recipes: [gridRecipeFromFloat(makeFloat([{ x: 0, y: 0, v: 1 }]))],
            rotation: 90,
            pixels: filledPixels(3, 3, 2),
            float: makeFloat([{ x: 2, y: 0, v: 1 }]),
            dangerColorOverride: "#123456",
            accentColorOverride: "#abcdef",
        });
        saveToLocalStorage(s);
        const loaded = loadFromLocalStorage();
        expect(loaded).not.toBeNull();
        expect(loaded!.colorA).toBe("#11ff22");
        expect(loaded!.activeTool).toBe("fill");
        expect(loaded!.primaryColor).toBe(2);
        expect(loaded!.mirrors).toHaveLength(2);
        expect(loaded!.mirrors.find(a => a.types.includes("V"))!.enabled).toBe(true);
        expect(loaded!.mirrors.find(a => a.types.includes("H"))!.enabled).toBe(true);
        expect(loaded!.recipes).toEqual(s.recipes);
        expect(loaded!.rotation).toBe(90);
        expect(loaded!.pixels[0]).toBe(2);
        expect(loaded!.float).not.toBeNull();
        expect(loaded!.float!.x).toBe(2);
        expect(loaded!.float!.y).toBe(0);
        expect(loaded!.float!.pixels[0]).toBe(1);
        expect(loaded!.dangerColorOverride).toBe("#123456");
        expect(loaded!.accentColorOverride).toBe("#abcdef");
        expect(() => contrastingProjectColors(loaded!.colorA, loaded!.colorB)).not.toThrow();
    });

    test("older recovery defaults project contrast overrides to app defaults", () => {
        saveToLocalStorage(rowSession(3, 3));
        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        delete raw.document.dangerColorOverride;
        delete raw.document.accentColorOverride;
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));

        expect(loadFromLocalStorage()).toMatchObject({
            dangerColorOverride: null,
            accentColorOverride: null,
        });
    });

    test("malformed project contrast overrides invalidate recovery", () => {
        saveToLocalStorage(rowSession(3, 3));
        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        raw.document.dangerColorOverride = "red";
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));

        expect(loadFromLocalStorage()).toBeNull();
    });

    test.each(["colorA", "colorB"] as const)(
        "malformed recovered yarn %s invalidates and clears recovery",
        field => {
            saveToLocalStorage(rowSession(3, 3));
            const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
            raw.document[field] = "red";
            localStorage.setItem("mosaic-recovery", JSON.stringify(raw));

            expect(loadFromLocalStorage()).toBeNull();
            expect(localStorage.getItem("mosaic-recovery")).toBeNull();
        },
    );

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

    test("saved sessions without recipes migrate to one empty selection", () => {
        saveToLocalStorage(rowSession(3, 3));
        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        delete raw.workspace.recipes;
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));

        const restored = loadFromLocalStorage()!;
        expect(restored.recipes).toHaveLength(1);
        expect(restored.recipes[0].source.mask).toHaveLength(0);
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

    test("recovery normalizes distinct legacy alternate gaps", () => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 1 }]));
        recipe.columnSpacingAlternate = 7;
        recipe.rowSpacingAlternate = 8;
        saveToLocalStorage(rowSession(3, 3, { recipes: [recipe] }));

        expect(loadFromLocalStorage()!.recipes[0]).toMatchObject({
            columnSpacingAlternate: 0,
            rowSpacingAlternate: 0,
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

        const restored = loadFromLocalStorage()!;
        expect(restored.recipes).toHaveLength(1);
        expect(restored.recipes[0].source.mask).toHaveLength(0);
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

    test("legacy paused global mirror mode is normalized on", () => {
        const session = rowSession(3, 3, { liveMirrors: false });
        saveToLocalStorage(session);

        const loaded = loadFromLocalStorage();
        expect(loaded!.liveMirrors).toBe(true);

        const raw = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        delete raw.workspace.liveTransforms;
        localStorage.setItem("mosaic-recovery", JSON.stringify(raw));
        const migrated = loadFromLocalStorage();
        expect(migrated!.liveMirrors).toBe(true);
    });

    test("current recovery drops stale mirrors before the restored project can save", () => {
        const valid = { id: "valid", types: ["V" as const], enabled: false, x: 1, y: 1 };
        const stale = { id: "stale", types: ["H" as const], enabled: true, x: 1, y: 0 };
        saveToLocalStorage(rowSession(3, 3, { mirrors: [valid, stale] }));

        const restored = loadFromLocalStorage()!;
        expect(restored.mirrors).toEqual([valid]);
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

    test("writes only project fields, including global mirror centres", async () => {
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
            mirrors: addMirror([], "V", { mode: "row", canvasWidth: 3, canvasHeight: 3 }),
            recipes: [gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 2 }]))],
            activeTool: "move",
            toolVariants: { select: "add", wand: "remove", move: "duplicate", overlay: "invert" },
            rotation: 45,
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
            dangerColorOverride: "#123456",
            accentColorOverride: "#abcdef",
        });

        await expect(saveToFile(session)).resolves.toBe(true);
        const file = JSON.parse(written);
        expect(file).toMatchObject({ version: 5, mirrors: session.mirrors });
        expect(file.recipes).toHaveLength(1);
        expect(file).toMatchObject({
            dangerColorOverride: "#123456",
            accentColorOverride: "#abcdef",
        });
        expect(file).not.toHaveProperty("activeTool");
        expect(file).not.toHaveProperty("toolVariants");
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
