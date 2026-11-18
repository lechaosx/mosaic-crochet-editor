// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { decodeMcw, decodeMcwWithMigration, encodeMcw } from "@mosaic/logic/mcw";
import { gridRecipeFromFloat } from "@mosaic/logic/grid-recipes";
import { packPixels } from "@mosaic/logic/storage";
import { loadFromLocalStorage, saveToLocalStorage } from "../src/storage-io";
import { historyFrom, loadHistory, writeHistory } from "../src/history";
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

test("current marked project, recovery, and history reject incomplete legacy-looking categories atomically", () => {
    const { session, legacy } = fixture();
    const file = JSON.parse(encodeMcw(session));
    file.recipes[0] = { ...legacy, source: file.recipes[0].source };
    expect(() => decodeMcwWithMigration(JSON.stringify(file))).toThrow();
    saveToLocalStorage(session);
    const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
    recovery.workspace.recipes = [legacy];
    localStorage.setItem("mosaic-recovery", JSON.stringify(recovery));
    expect(loadFromLocalStorage()).toBeNull();
    writeHistory(historyFrom(session));
    const history = JSON.parse(localStorage.getItem("mosaic-history")!);
    history.snapshots[0].transforms.recipes = [legacy];
    localStorage.setItem("mosaic-history", JSON.stringify(history));
    expect(loadHistory()).toBeNull();
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
        writeHistory(historyFrom(session));
        const history = JSON.parse(localStorage.getItem("mosaic-history")!);
        delete history.snapshots[0].transforms.recipes[0][field];
        localStorage.setItem("mosaic-history", JSON.stringify(history));
        expect(loadHistory()).toBeNull();
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
            writeHistory(historyFrom(session));
            const history = JSON.parse(localStorage.getItem("mosaic-history")!);
            history.snapshots[0].transforms.recipes[0][field] = value;
            localStorage.setItem("mosaic-history", JSON.stringify(history));
            expect(loadHistory()).toBeNull();
        }
    });
