// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { decodeMcw, decodeMcwWithMigration, encodeMcw } from "@mosaic/logic/mcw";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";
import { packFloat, packPixels } from "@mosaic/logic/storage";
import { loadFromLocalStorage, saveToLocalStorage } from "../src/storage-io";
import { historyEnsureInitialized, historyPeek, historySave, historyUndo, historyRedo } from "../src/history";
import { rowSession } from "./_helpers";

beforeEach(() => localStorage.clear());
const legacyCases = [
    { name: "Grid with dormant centre settings", oldMode: "grid", turns: [90], horizontal: true, vertical: true, mode: "grid", types: ["V", "H"], changed: false },
    { name: "chosen turns", oldMode: "rotation", turns: [90, 270], horizontal: false, vertical: false, mode: "circle", types: [], changed: false },
    { name: "horizontal reflection", oldMode: "rotation", turns: [], horizontal: true, vertical: false, mode: "mirror", types: ["V"], changed: false },
    { name: "vertical reflection", oldMode: "rotation", turns: [], horizontal: false, vertical: true, mode: "mirror", types: ["H"], changed: false },
    { name: "combined reflections", oldMode: "rotation", turns: [], horizontal: true, vertical: true, mode: "mirror", types: ["V", "H"], changed: true },
    { name: "mixed turns and reflections", oldMode: "rotation", turns: [90], horizontal: true, vertical: true, mode: "circle", types: ["V", "H"], changed: true },
    { name: "empty rotation", oldMode: "rotation", turns: [], horizontal: false, vertical: false, mode: "circle", types: [], changed: false },
];
function fixture(policy = legacyCases[4]) {
    const float = { x: 3, y: 3, w: 3, h: 1, pixels: new Uint8Array([2, 0, 1]) };
    const recipe = gridRecipeFromFloat(float);
    const legacy = { ...recipe, mode: policy.oldMode, rotationCentreX: 2, rotationCentreY: 2,
        rotationTurns: policy.turns, mirrorHorizontal: policy.horizontal, mirrorVertical: policy.vertical } as Record<string, unknown>;
    delete legacy.mirrorCentreX; delete legacy.mirrorCentreY; delete legacy.mirrorTypes;
    const session = rowSession(9, 9, { float, recipes: [recipe], activeRecipeId: recipe.id,
        dangerColorOverride: "#ffaa00", accentColorOverride: "#0099ff" });
    return { session, recipe, legacy, float };
}

test.each([3, 4, 5])("project v%s defaults genuinely omitted older centred settings", version => {
    const { session, recipe, legacy } = fixture(legacyCases[0]);
    for (const field of ["mode", "rotationCentreX", "rotationCentreY", "rotationTurns", "mirrorHorizontal", "mirrorVertical"]) delete legacy[field];
    if (version === 3) {
        legacy.columnOrientation = "same"; legacy.rowOrientation = "same";
        for (const field of ["columnMirrorHorizontal", "columnMirrorVertical", "rowMirrorHorizontal", "rowMirrorVertical"]) delete legacy[field];
    }
    const file = { ...JSON.parse(encodeMcw(session)), version, axes: [],
        recipes: [{ ...legacy, source: { ...recipe.source, mask: "BQ==" } }] };
    const restored = decodeMcwWithMigration(JSON.stringify(file));
    expect(restored.selectionBehaviorChanged).toBe(false);
    expect(restored.project.recipes[0]).toMatchObject({ id: recipe.id, mode: "grid", rotationCentreX: 4,
        rotationCentreY: 3, mirrorCentreX: 4, mirrorCentreY: 3, rotationTurns: [], mirrorTypes: [], source: recipe.source });
});

test.each([3, 4, 5].flatMap(version => legacyCases.map(policy => ({ version, ...policy }))))(
    "project v$version migrates $name without changing authored content", policy => {
    const { version } = policy;
    const { session, recipe, legacy } = fixture(policy);
    if (version === 3) {
        legacy.columnOrientation = "same"; legacy.rowOrientation = "same";
        for (const key of ["columnMirrorHorizontal", "columnMirrorVertical", "rowMirrorHorizontal", "rowMirrorVertical"]) delete legacy[key];
    }
    const raw = { version, state: session.pattern, pixels: packPixels(session.pixels),
        colorA: session.colorA, colorB: session.colorB, axes: [], mirrors: [],
        dangerColorOverride: session.dangerColorOverride, accentColorOverride: session.accentColorOverride,
        recipes: [{ ...legacy, source: { ...recipe.source, mask: "BQ==" } }] };
    const { project: restored, selectionBehaviorChanged } = decodeMcwWithMigration(JSON.stringify(raw));
    expect(selectionBehaviorChanged).toBe(policy.changed);
    expect(restored).toMatchObject({ pattern: session.pattern, pixels: session.pixels,
        colorA: session.colorA, colorB: session.colorB, dangerColorOverride: session.dangerColorOverride,
        accentColorOverride: session.accentColorOverride });
    expect(restored.recipes[0]).toMatchObject({ id: recipe.id, mode: policy.mode, mirrorTypes: policy.types,
        rotationTurns: policy.turns, rotationCentreX: 2, rotationCentreY: 2, mirrorCentreX: 2, mirrorCentreY: 2, source: recipe.source });
    const roundTrip = decodeMcw(encodeMcw(restored));
    expect(roundTrip).toEqual(restored);
    expect(decodeMcwWithMigration(encodeMcw(restored)).selectionBehaviorChanged).toBe(false);
    expect(JSON.parse(encodeMcw(restored))).not.toHaveProperty("migrationNotice");
});

test.each([5, 6, 7, 8].flatMap(version => legacyCases.map(policy => ({ version, ...policy }))))(
    "recovery v$version migrates $name with source float and dormant settings", policy => {
    const { version } = policy;
    const { session, recipe, legacy, float } = fixture(policy);
    localStorage.setItem("mosaic-recovery", JSON.stringify({ version,
        document: { state: session.pattern, pixels: packPixels(session.pixels), colorA: session.colorA, colorB: session.colorB,
            dangerColorOverride: session.dangerColorOverride, accentColorOverride: session.accentColorOverride },
        workspace: { activeTool: "select", ...(version >= 7 ? { toolVariants: session.toolVariants } : {}), primaryColor: 1,
            ...(version === 8 ? { mirrors: [] } : { axes: [] }),
            recipes: [{ ...legacy, source: { ...recipe.source, mask: [1, 0, 1] } }],
            activeRecipeId: recipe.id, float: packFloat(float), ...(version >= 6 ? { rotation: 90 } : {}) },
        ...(version === 5 ? { preferences: { hlOpacity: 55, invalidIntensity: 70, labelsVisible: true,
            lockInvalid: true, canvasRotation: 90 } } : {}) }));
    let noticed = false;
    const restored = loadFromLocalStorage(() => { noticed = true; })!;
    expect(noticed).toBe(policy.changed);
    expect(restored).toMatchObject({ pattern: session.pattern, pixels: session.pixels, colorA: session.colorA,
        colorB: session.colorB, dangerColorOverride: session.dangerColorOverride, accentColorOverride: session.accentColorOverride });
    expect(restored.float).toEqual(float);
    expect(restored.activeRecipeId).toBe(recipe.id);
    expect(restored.recipes[0]).toMatchObject({ id: recipe.id, mode: policy.mode, mirrorTypes: policy.types,
        rotationTurns: policy.turns, rotationCentreX: 2, rotationCentreY: 2, mirrorCentreX: 2, mirrorCentreY: 2, source: recipe.source });
    restored.recipes[0] = { ...restored.recipes[0], mode: "circle", rotationCentreX: 4, rotationCentreY: 4 };
    expect(saveToLocalStorage(restored)).toBe(true);
    expect(loadFromLocalStorage()!.recipes[0]).toMatchObject({ mode: "circle", rotationCentreX: 4, mirrorCentreX: 2 });
});

test.each([5, 6, 7].flatMap(version => legacyCases.map(policy => ({ version, ...policy }))))(
    "history v$version migrates $name and retains dormant settings across Undo and Redo", policy => {
    const { version } = policy;
    const { session, recipe, legacy, float } = fixture(policy);
    localStorage.setItem("mosaic-history", JSON.stringify({ version, index: 0, snapshots: [{
        document: { state: session.pattern, pixels: packPixels(session.pixels), colorA: session.colorA, colorB: session.colorB },
        selection: packFloat(float), transforms: { ...(version === 7 ? { mirrors: [] } : { axes: [] }), activeRecipeId: recipe.id,
            recipes: [{ ...legacy, source: { ...recipe.source, mask: [1, 0, 1] } }] },
    }] }));
    let noticed = false;
    historyEnsureInitialized(session, () => { noticed = true; });
    expect(noticed).toBe(policy.changed);
    const before = historyPeek()!;
    expect(before).toMatchObject({ pattern: session.pattern, pixels: session.pixels, colorA: session.colorA,
        colorB: session.colorB, float, activeRecipeId: recipe.id });
    expect(before.recipes[0]).toMatchObject({ id: recipe.id, mode: policy.mode, mirrorTypes: policy.types,
        rotationTurns: policy.turns, rotationCentreX: 2, rotationCentreY: 2, mirrorCentreX: 2, mirrorCentreY: 2, source: recipe.source });
    expect(before.dangerColorOverride).toBeUndefined();
    historySave({ ...session, ...before, recipes: [{ ...before.recipes[0], mode: "none", mirrorCentreX: 6 }] });
    expect(historyUndo()!.recipes).toEqual(before.recipes);
    expect(historyRedo()!.recipes[0]).toMatchObject({ mode: "none", rotationCentreX: 2, mirrorCentreX: 6 });
});

test("an unchanged current recovery discloses changed behavior in an older Undo snapshot once", () => {
    const { session, recipe, legacy, float } = fixture();
    saveToLocalStorage(session);
    localStorage.setItem("mosaic-history", JSON.stringify({ version: 7, index: 0, snapshots: [{
        document: { state: session.pattern, pixels: packPixels(session.pixels), colorA: session.colorA, colorB: session.colorB },
        selection: packFloat(float), transforms: { mirrors: [], activeRecipeId: recipe.id,
            recipes: [{ ...legacy, source: { ...recipe.source, mask: [1, 0, 1] } }] },
    }] }));
    let notices = 0;
    const restored = loadFromLocalStorage(() => notices++)!;
    expect(notices).toBe(0);
    historyEnsureInitialized(restored, () => notices++);
    expect(notices).toBe(1);
    historyEnsureInitialized(restored, () => notices++);
    expect(notices).toBe(1);
    expect(historyPeek()!.recipes[0].mode).toBe("mirror");
});

test("current marked project, recovery, and history reject incomplete legacy-looking categories atomically", () => {
    const { session, legacy } = fixture();
    const file = JSON.parse(encodeMcw(session));
    file.recipes[0] = { ...legacy, source: file.recipes[0].source };
    let notices = 0;
    expect(() => decodeMcwWithMigration(JSON.stringify(file))).toThrow();
    saveToLocalStorage(session);
    const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
    recovery.workspace.recipes = [legacy];
    localStorage.setItem("mosaic-recovery", JSON.stringify(recovery));
    expect(loadFromLocalStorage(() => notices++)).toBeNull();
    historySave(session);
    const history = JSON.parse(localStorage.getItem("mosaic-history")!);
    history.snapshots[0].transforms.recipes = [legacy];
    localStorage.setItem("mosaic-history", JSON.stringify(history));
    expect(historyPeek()).toBeNull();
    expect(notices).toBe(0);
});

test.each(["mode", "rotationCentreX", "mirrorCentreY", "rotationTurns", "mirrorTypes"])(
    "current project, recovery, and history require category field %s", field => {
        const { session } = fixture();
        const file = JSON.parse(encodeMcw(session));
        delete file.recipes[0][field];
        expect(() => decodeMcwWithMigration(JSON.stringify(file))).toThrow();
        saveToLocalStorage(session);
        const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        delete recovery.workspace.recipes[0][field];
        localStorage.setItem("mosaic-recovery", JSON.stringify(recovery));
        expect(loadFromLocalStorage()).toBeNull();
        historySave(session);
        const history = JSON.parse(localStorage.getItem("mosaic-history")!);
        delete history.snapshots[0].transforms.recipes[0][field];
        localStorage.setItem("mosaic-history", JSON.stringify(history));
        expect(historyPeek()).toBeNull();
    });

const malformedCategories = [
    ...["rotationCentreX", "rotationCentreY", "mirrorCentreX", "mirrorCentreY"].flatMap(field =>
        ["2", false, null].map(value => ({ field, value }))),
    ...["mode", "rotationTurns", "mirrorTypes"].map(field => ({ field, value: null })),
];
test.each(malformedCategories.flatMap(value => ["project", "recovery", "history"].map(boundary => ({ ...value, boundary }))))(
    "$boundary rejects malformed $field = $value instead of inferring centred settings", ({ field, value, boundary }) => {
        const { session } = fixture();
        if (boundary === "project") {
            const file = JSON.parse(encodeMcw(session));
            file.recipes[0][field] = value;
            expect(() => decodeMcwWithMigration(JSON.stringify(file))).toThrow();
        } else if (boundary === "recovery") {
            saveToLocalStorage(session);
            const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
            recovery.workspace.recipes[0][field] = value;
            localStorage.setItem("mosaic-recovery", JSON.stringify(recovery));
            expect(loadFromLocalStorage()).toBeNull();
        } else {
            historySave(session);
            const history = JSON.parse(localStorage.getItem("mosaic-history")!);
            history.snapshots[0].transforms.recipes[0][field] = value;
            localStorage.setItem("mosaic-history", JSON.stringify(history));
            expect(historyPeek()).toBeNull();
        }
    });
