// @vitest-environment jsdom
// Recovery record and file IO tests — pure pack/unpack tests live in logic/tests/storage.test.ts.

import { describe, test, expect, afterEach, vi } from "vitest";
import { recoveryRecord, sessionFromRecovery, saveToFile, loadFromFile } from "../src/storage-io";
import { rowSession, filledPixels, makeFloat } from "./_helpers";
import { addMirror } from "@mosaic/logic/symmetry";
import { encodeMcw } from "@mosaic/logic/mcw";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";
import { contrastingProjectColors } from "../src/contrast-colors";
import type { SessionState } from "@mosaic/logic/store";

// The session as read back from its stored recovery record, with `edit`
// applied to the stored record first.
function recovered(s: SessionState, edit: (record: any) => void = () => {}) {
    const record = structuredClone(recoveryRecord(s));
    edit(record);
    return sessionFromRecovery(record);
}

describe("recoveryRecord / sessionFromRecovery", () => {
    test("chosen tool variants are recovered independently of authored content", () => {
        const toolVariants = { select: "add", wand: "remove", move: "duplicate", overlay: "clear" } as const;
        const session = rowSession(3, 3, { toolVariants });
        expect(recovered(session)).toMatchObject({ toolVariants });
        const record = recoveryRecord(session);
        expect(record.workspace.toolVariants).toEqual(toolVariants);
        expect(record.document).not.toHaveProperty("toolVariants");
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
        const loaded = recovered(s);
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

    test("default contrast overrides round-trip as app defaults", () => {
        expect(recovered(rowSession(3, 3))).toMatchObject({
            dangerColorOverride: null,
            accentColorOverride: null,
        });
    });

    test.each(["dangerColorOverride", "accentColorOverride"])("recovery without %s → null", field => {
        expect(recovered(rowSession(3, 3), record => { delete record.document[field]; })).toBeNull();
    });

    test("malformed project contrast overrides invalidate recovery", () => {
        expect(recovered(rowSession(3, 3), record => { record.document.dangerColorOverride = "red"; })).toBeNull();
    });

    test.each(["colorA", "colorB"] as const)("malformed recovered yarn %s invalidates recovery", field => {
        expect(recovered(rowSession(3, 3), record => { record.document[field] = "red"; })).toBeNull();
    });

    test.each([undefined, "90"])("recovery with rotation %s → null", rotation => {
        expect(recovered(rowSession(3, 3), record => { record.workspace.rotation = rotation; })).toBeNull();
    });

    test("nothing stored → null", () => {
        expect(sessionFromRecovery(undefined)).toBeNull();
    });

    test("wrong version → null even with otherwise-valid payload", () => {
        expect(recovered(rowSession(3, 3), record => { record.version = 999; })).toBeNull();
    });

    test("recovery retains alternate gaps in current records", () => {
        const recipe = gridRecipeFromFloat(makeFloat([{ x: 1, y: 1, v: 1 }]));
        recipe.columnSpacingAlternate = 7;
        recipe.rowSpacingAlternate = 8;

        expect(recovered(rowSession(3, 3, { recipes: [recipe] }))!.recipes[0]).toMatchObject({
            columnSpacingAlternate: 7,
            rowSpacingAlternate: 8,
        });
    });

    test("recovery clears an active recipe whose float does not match its source", () => {
        const source = makeFloat([{ x: 0, y: 0, v: 1 }]);
        const recipe = gridRecipeFromFloat(source);

        expect(recovered(rowSession(3, 3, {
            recipes: [recipe],
            activeRecipeId: recipe.id,
            float: makeFloat([{ x: 1, y: 0, v: 1 }]),
        }))!.activeRecipeId).toBeNull();
    });

    test("paused global mirror mode is recovered on", () => {
        expect(recovered(rowSession(3, 3, { liveMirrors: false }))!.liveMirrors).toBe(true);
    });

    test("current recovery drops stale mirrors before the restored project can save", () => {
        const valid = { id: "valid", types: ["V" as const], enabled: false, x: 1, y: 1 };
        const stale = { id: "stale", types: ["H" as const], enabled: true, x: 1, y: 0 };

        const restored = recovered(rowSession(3, 3, { mirrors: [valid, stale] }))!;
        expect(restored.mirrors).toEqual([valid]);
        expect(() => encodeMcw(restored)).not.toThrow();
    });

    test("missing state → null", () => {
        expect(sessionFromRecovery({ version: 9 })).toBeNull();
    });

    test("oversized saved dimensions are rejected before pixel allocation", () => {
        expect(recovered(rowSession(3, 3), record => {
            record.document.state.canvasWidth = 32_768;
            record.document.state.canvasHeight = 1;
        })).toBeNull();
    });

    test("non-square canvas with float round-trips correctly", () => {
        const f = makeFloat([{ x: 3, y: 1, v: 2 }]);
        const loaded = recovered(rowSession(4, 2, { pixels: filledPixels(4, 2, 1), float: f }));
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

    test("resolves null when the file picker is cancelled", async () => {
        Object.assign(window, {
            showSaveFilePicker: () => Promise.reject(new DOMException("cancelled", "AbortError")),
        });

        await expect(saveToFile(rowSession(3, 3), "motif.mcw")).resolves.toBeNull();
    });

    test("suggests the given name and resolves the name of the chosen file", async () => {
        let suggested = "";
        Object.assign(window, {
            showSaveFilePicker: async (options: { suggestedName: string }) => {
                suggested = options.suggestedName;
                return { name: "scarf.mcw", createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
            },
        });

        await expect(saveToFile(rowSession(3, 3), "motif.mcw")).resolves.toBe("scarf.mcw");
        expect(suggested).toBe("motif.mcw");
    });

    test("without a file picker, downloads under the given name and resolves it", async () => {
        let downloaded = "";
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            downloaded = this.download;
        });
        Object.assign(URL, { createObjectURL: () => "blob:", revokeObjectURL: () => {} });

        await expect(saveToFile(rowSession(3, 3), "motif.mcw")).resolves.toBe("motif.mcw");
        expect(downloaded).toBe("motif.mcw");
        vi.restoreAllMocks();
    });

    test("propagates file picker failures", async () => {
        Object.assign(window, {
            showSaveFilePicker: () => Promise.reject(new Error("Disk full.")),
        });

        await expect(saveToFile(rowSession(3, 3), "motif.mcw")).rejects.toThrow("Disk full.");
    });

    test("writes only project fields, including global mirror centres", async () => {
        let written = "";
        Object.assign(window, {
            showSaveFilePicker: async () => ({
                name: "pattern.mcw",
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

        await expect(saveToFile(session, "pattern.mcw")).resolves.toBe("pattern.mcw");
        const file = JSON.parse(written);
        expect(file).toMatchObject({ version: 6, mirrors: session.mirrors });
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
