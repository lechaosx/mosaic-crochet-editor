// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { loadFromLocalStorage } from "../src/storage-io";
import { historyPeek, historyUndo, historyRedo } from "../src/history";
import { rowSession, makeFloat } from "./_helpers";
import { packFloat, packPixels } from "@mosaic/logic/storage";
import { gridRecipeFromFloat, storedGridRecipes } from "@mosaic/logic/grid-recipes";

beforeEach(() => localStorage.clear());
const axes = [
    { id: "v", kind: "V", active: true, x: 1 },
    { id: "v-off", kind: "V", active: false, x: 1.5 },
    { id: "v-repeat", kind: "V", active: true, x: 1 },
    { id: "point", kind: "C", active: true, x: 1, y: 1.5 },
];
const mirrors = [
    { id: "v", types: ["V"], enabled: true, x: 1, y: 1.5 },
    { id: "v-off", types: ["V"], enabled: false, x: 1.5, y: 1.5 },
    { id: "v-repeat", types: ["V"], enabled: true, x: 1, y: 1.5 },
    { id: "point", types: ["C"], enabled: true, x: 1, y: 1.5 },
];

test.each([4, 5, 6, 7])("recovery v%s preserves authored and workspace data while migrating axes", version => {
    const float = makeFloat([{ x: 1, y: 1, v: 2 }]);
    const recipe = gridRecipeFromFloat(float);
    const session = rowSession(4, 4, { float, recipes: [recipe], activeRecipeId: recipe.id });
    const document = { state: session.pattern, pixels: packPixels(session.pixels), colorA: session.colorA, colorB: session.colorB, dangerColorOverride: "#fedcba", accentColorOverride: "#123456" };
    const workspace = { activeTool: "wand", primaryColor: 2, axes, float: packFloat(float), recipes: storedGridRecipes([recipe]), activeRecipeId: recipe.id, rotation: 90, toolVariants: { select: "add", wand: "remove", move: "duplicate", overlay: "clear" } };
    const preferences = { hlOpacity: 30, labelsVisible: true, lockInvalid: false, canvasRotation: 90 };
    const recovery = version === 4 ? { version, ...document, ...workspace, ...preferences } : { version, document, workspace, preferences };
    localStorage.setItem("mosaic-recovery", JSON.stringify(recovery));
    const loaded = loadFromLocalStorage()!;
    expect(loaded.mirrors).toEqual(mirrors);
    expect(loaded.pixels).toEqual(session.pixels);
    expect(loaded.pattern).toEqual(session.pattern);
    expect(loaded.float).toEqual(float);
    expect(loaded).toMatchObject({ activeTool: "wand", primaryColor: 2, rotation: 90 });
    if (version >= 5) expect(loaded.recipes).toEqual([recipe]);
    if (version >= 6) expect(loaded).toMatchObject({ dangerColorOverride: "#fedcba", accentColorOverride: "#123456" });
    if (version === 7) expect(loaded.toolVariants).toEqual(workspace.toolVariants);
    const migrated = JSON.parse(localStorage.getItem("mosaic-recovery")!);
    expect(migrated.version).toBe(8);
    expect(migrated.workspace.mirrors).toEqual(mirrors);
    expect(migrated.workspace).not.toHaveProperty("axes");
});

test.each([undefined, 5, 6])("history v%s preserves axis identity and authored snapshots through undo/redo", version => {
    const float = makeFloat([{ x: 1, y: 1, v: 2 }, { x: 2, y: 2, v: 1 }]);
    const recipe = gridRecipeFromFloat(float);
    const session = rowSession(4, 4);
    const snapshot = { document: { state: session.pattern, pixels: packPixels(session.pixels), colorA: session.colorA, colorB: session.colorB, dangerColorOverride: null, accentColorOverride: "#abcdef" }, selection: packFloat(float), transforms: { axes, recipes: storedGridRecipes([recipe]), activeRecipeId: recipe.id } };
    const snapshots = [snapshot, { ...snapshot, document: { ...snapshot.document, colorA: "#123456" } }];
    const raw = version === undefined ? { snapshots: snapshots.map(s => ({ ...s.document, float: packFloat(float), axes })), index: 1 } : { version, snapshots, index: 1 };
    localStorage.setItem("mosaic-history", JSON.stringify(raw));
    expect(historyPeek()!.mirrors).toEqual(mirrors);
    expect(historyUndo()!).toMatchObject({ mirrors, colorA: "#000000" });
    expect(historyRedo()!).toMatchObject({ mirrors, colorA: "#123456" });
    expect(historyPeek()!.pixels).toEqual(session.pixels);
    expect(historyPeek()!.float).toEqual(float);
    if (version !== undefined) {
        expect(historyPeek()!.recipes).toEqual([recipe]);
        expect(historyPeek()!.activeRecipeId).toBe(recipe.id);
        expect(historyPeek()!).toMatchObject({ dangerColorOverride: null, accentColorOverride: "#abcdef" });
    }
    expect(JSON.parse(localStorage.getItem("mosaic-history")!).version).toBe(7);
    expect(JSON.parse(localStorage.getItem("mosaic-history")!).snapshots[0].transforms).not.toHaveProperty("axes");
});
