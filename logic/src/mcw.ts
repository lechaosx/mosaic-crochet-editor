import { assertPatternDimensions } from "./pattern";
import { b64ToU8, packPixels, u8ToB64, unpackPixels } from "./storage";
import { axisIsProjectValid, migrateAxes, mirrorIsProjectValid, readMirrorRecords } from "./symmetry";
import { emptyGridRecipe, legacySelectionBehaviorChanged, restoreGridRecipes } from "./grid-recipes";
import type { Axis, MirrorCenter, GridRecipe, PatternState } from "./types";

export const MCW_VERSION = 6;

// This is the complete editable project boundary. Workspace controls,
// selection state, app preferences, and history deliberately stay outside it.
export interface ProjectDocument {
    pattern: PatternState;
    pixels:  Uint8Array;
    colorA:  string;
    colorB:  string;
    mirrors: MirrorCenter[];
    recipes: GridRecipe[];
    dangerColorOverride?: string | null;
    accentColorOverride?: string | null;
}

interface McwV2 {
    version: 2;
    state:   PatternState;
    pixels:  string;
    colorA:  string;
    colorB:  string;
}

interface McwV6 extends Omit<McwV2, "version"> {
    version: 6;
    mirrors: MirrorCenter[];
    recipes?: unknown[];
    dangerColorOverride?: string;
    accentColorOverride?: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function packMask(mask: Uint8Array): string {
    const packed = new Uint8Array(Math.ceil(mask.length / 8));
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] !== 0) packed[i >> 3] |= 1 << (i & 7);
    }
    return u8ToB64(packed);
}

function unpackMask(source: string, length: number): Uint8Array {
    const bytes = b64ToU8(source);
    if (bytes.length !== Math.ceil(length / 8)) throw invalidFile();
    const mask = new Uint8Array(length);
    for (let i = 0; i < length; i++) mask[i] = (bytes[i >> 3] >> (i & 7)) & 1;
    return mask;
}

function readRecipes(value: unknown, legacy = false): GridRecipe[] {
    if (value === undefined && legacy) return [emptyGridRecipe()];
    if (!Array.isArray(value)) throw invalidFile();
    const decoded = value.map(item => {
        if (!isRecord(item) || !isRecord(item.source) || typeof item.source.mask !== "string"
            || typeof item.source.w !== "number" || typeof item.source.h !== "number"
            || !Number.isSafeInteger(item.source.w) || !Number.isSafeInteger(item.source.h)
            || item.source.w < 0 || item.source.h < 0
            || (item.source.w === 0) !== (item.source.h === 0)) throw invalidFile();
        return { ...item, id: item.id, source: { ...item.source,
            mask: Array.from(unpackMask(item.source.mask, item.source.w * item.source.h)) } };
    });
    const recipes = restoreGridRecipes(decoded, legacy);
    if (decoded.some((value, index) => value.id !== recipes[index]?.id)
        || (value.length !== recipes.length && value.length !== 0)) throw invalidFile();
    if (!legacy && recipes.length === 0) throw invalidFile();
    return recipes;
}

function writeRecipes(recipes: ReadonlyArray<GridRecipe> = []): McwV6["recipes"] {
    const checked = readRecipes(recipes.map(recipe => ({ ...recipe, source: {
        ...recipe.source,
        mask: packMask(recipe.source.mask),
    } })));
    return checked.filter(recipe => recipe.source.mask.length > 0)
        .map(recipe => ({ ...recipe, source: { ...recipe.source, mask: packMask(recipe.source.mask) } }));
}

function invalidFile(): Error {
    return new Error("Invalid pattern file.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCommon(data: Record<string, unknown>): {
    pattern: PatternState;
    colorA: string;
    colorB: string;
} {
    if (!isRecord(data.state)) {
        throw invalidFile();
    }
    const pattern = data.state as unknown as PatternState;
    assertPatternDimensions(pattern);
    return { pattern, colorA: readYarnColor(data.colorA), colorB: readYarnColor(data.colorB) };
}

function readYarnColor(value: unknown): string {
    if (typeof value !== "string" || !HEX_COLOR.test(value)) throw invalidFile();
    return value;
}

function readColorOverride(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !HEX_COLOR.test(value)) throw invalidFile();
    return value;
}

function readAxes(value: unknown, pattern: PatternState): Axis[] {
    if (!Array.isArray(value)) throw invalidFile();
    const ids = new Set<string>();
    return value.map(item => {
        if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0
            || typeof item.active !== "boolean") throw invalidFile();
        if (ids.has(item.id)) throw invalidFile();
        ids.add(item.id);
        const x = item.x, y = item.y, c = item.c;
        let axis: Axis;
        switch (item.kind) {
            case "V":  if (typeof x === "number" && Number.isFinite(x)) axis = { id: item.id, active: item.active, kind: "V", x }; else throw invalidFile(); break;
            case "H":  if (typeof y === "number" && Number.isFinite(y)) axis = { id: item.id, active: item.active, kind: "H", y }; else throw invalidFile(); break;
            case "C":  if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) axis = { id: item.id, active: item.active, kind: "C", x, y }; else throw invalidFile(); break;
            case "D1": if (typeof c === "number" && Number.isFinite(c)) axis = { id: item.id, active: item.active, kind: "D1", c }; else throw invalidFile(); break;
            case "D2": if (typeof c === "number" && Number.isFinite(c)) axis = { id: item.id, active: item.active, kind: "D2", c }; else throw invalidFile(); break;
            default: throw invalidFile();
        }
        if (!axisIsProjectValid(axis, pattern)) throw invalidFile();
        return axis;
    });
}

export function encodeMcw(document: Readonly<ProjectDocument>): string {
    assertPatternDimensions(document.pattern);
    if (document.pixels.length !== document.pattern.canvasWidth * document.pattern.canvasHeight) {
        throw invalidFile();
    }
    const mirrors = readMirrorRecords(document.mirrors);
    if (!mirrors || !mirrors.every(mirror => mirrorIsProjectValid(mirror, document.pattern))) throw invalidFile();
    const file: McwV6 = {
        version: MCW_VERSION,
        state: document.pattern,
        pixels: packPixels(document.pixels),
        colorA: readYarnColor(document.colorA),
        colorB: readYarnColor(document.colorB),
        mirrors,
        recipes: writeRecipes(document.recipes),
    };
    const dangerColorOverride = readColorOverride(document.dangerColorOverride);
    const accentColorOverride = readColorOverride(document.accentColorOverride);
    if (dangerColorOverride !== null) file.dangerColorOverride = dangerColorOverride;
    if (accentColorOverride !== null) file.accentColorOverride = accentColorOverride;
    return JSON.stringify(file);
}

export function decodeMcw(source: string): ProjectDocument {
    return decodeMcwWithMigration(source).project;
}

export function decodeMcwWithMigration(source: string): { project: ProjectDocument; selectionBehaviorChanged: boolean } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch {
        throw invalidFile();
    }
    if (!isRecord(parsed)) throw invalidFile();
    if (typeof parsed.version === "number" && Number.isInteger(parsed.version) && parsed.version > MCW_VERSION) {
        throw new Error(`This pattern uses unsupported .mcw version ${parsed.version}.`);
    }
    if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4 && parsed.version !== 5 && parsed.version !== MCW_VERSION) throw invalidFile();

    const common = readCommon(parsed);
    const expectedLength = common.pattern.canvasWidth * common.pattern.canvasHeight;
    if (parsed.version === 1) {
        if (!Array.isArray(parsed.pixels) || parsed.pixels.length !== expectedLength
            || !parsed.pixels.every(pixel => Number.isInteger(pixel) && pixel >= 0 && pixel <= 2)) {
            throw invalidFile();
        }
        return { project: {
            ...common, pixels: new Uint8Array(parsed.pixels), mirrors: [], recipes: [emptyGridRecipe()],
            dangerColorOverride: null, accentColorOverride: null,
        }, selectionBehaviorChanged: false };
    }
    if (typeof parsed.pixels !== "string") throw invalidFile();
    try {
        const recipes = parsed.version >= 3 ? readRecipes(parsed.recipes, parsed.version < MCW_VERSION) : [emptyGridRecipe()];
        const mirrors = parsed.version >= 5 ? readMirrorRecords(parsed.mirrors)
            : parsed.version >= 3 ? migrateAxes(readAxes(parsed.axes, common.pattern), common.pattern) : [];
        if (!mirrors || !mirrors.every(mirror => mirrorIsProjectValid(mirror, common.pattern))) throw invalidFile();
        const document: ProjectDocument = {
            ...common,
            pixels: unpackPixels(parsed.pixels, common.pattern),
            mirrors,
            recipes,
            dangerColorOverride: parsed.version >= 3 ? readColorOverride(parsed.dangerColorOverride) : null,
            accentColorOverride: parsed.version >= 3 ? readColorOverride(parsed.accentColorOverride) : null,
        };
        return { project: document,
            selectionBehaviorChanged: parsed.version < MCW_VERSION && legacySelectionBehaviorChanged(parsed.recipes) };
    } catch {
        throw invalidFile();
    }
}
