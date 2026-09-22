import { assertPatternDimensions } from "./pattern";
import { b64ToU8, packPixels, u8ToB64, unpackPixels } from "./storage";
import { axisIsProjectValid } from "./symmetry";
import { gridRecipeError } from "./grid-recipes";
import type { Axis, GridRecipe, PatternState } from "./types";

export const MCW_VERSION = 3;

// This is the complete editable project boundary. Workspace controls,
// selection state, app preferences, and history deliberately stay outside it.
export interface ProjectDocument {
    pattern: PatternState;
    pixels:  Uint8Array;
    colorA:  string;
    colorB:  string;
    axes:    Axis[];
    recipes: GridRecipe[];
}

interface McwV2 {
    version: 2;
    state:   PatternState;
    pixels:  string;
    colorA:  string;
    colorB:  string;
}

interface McwV3 extends Omit<McwV2, "version"> {
    version: 3;
    axes: Axis[];
    recipes?: unknown[];
}

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

function readRecipes(value: unknown): GridRecipe[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw invalidFile();
    const ids = new Set<string>();
    const recipes = value.map(item => {
        if (!isRecord(item) || !isRecord(item.source) || typeof item.id !== "string" || ids.has(item.id)
            || typeof item.enabled !== "boolean" || typeof item.source.x !== "number"
            || typeof item.source.y !== "number" || typeof item.source.w !== "number"
            || typeof item.source.h !== "number" || typeof item.source.mask !== "string") throw invalidFile();
        ids.add(item.id);
        if (!Number.isSafeInteger(item.source.w) || !Number.isSafeInteger(item.source.h)
            || item.source.w <= 0 || item.source.h <= 0) throw invalidFile();
        const number = (key: string) => {
            if (typeof item[key] !== "number") throw invalidFile();
            return item[key] as number;
        };
        const optionalNumber = (key: string, fallback: number) => {
            if (item[key] === undefined) return fallback;
            return number(key);
        };
        const string = (key: string) => {
            if (typeof item[key] !== "string") throw invalidFile();
            return item[key] as string;
        };
        let mask: Uint8Array;
        try { mask = unpackMask(item.source.mask, item.source.w * item.source.h); }
        catch { throw invalidFile(); }
        const columnSpacing = number("columnSpacing");
        const rowSpacing = number("rowSpacing");
        const mode = item.mode ?? "grid";
        if (mode !== "grid" && mode !== "rotation") throw invalidFile();
        const rotationTurns = item.rotationTurns ?? [];
        if (!Array.isArray(rotationTurns)
            || rotationTurns.some(turn => turn !== 90 && turn !== 180 && turn !== 270)) throw invalidFile();
        const recipe: GridRecipe = {
            id: item.id, enabled: item.enabled,
            source: { x: item.source.x, y: item.source.y, w: item.source.w, h: item.source.h, mask },
            mode,
            left: number("left"), right: number("right"), up: number("up"), down: number("down"),
            columnSpacing, rowSpacing,
            columnSpacingAlternate: optionalNumber("columnSpacingAlternate", columnSpacing),
            rowSpacingAlternate: optionalNumber("rowSpacingAlternate", rowSpacing),
            columnOffset: number("columnOffset"), rowOffset: number("rowOffset"),
            columnOrientation: string("columnOrientation") as GridRecipe["columnOrientation"],
            rowOrientation: string("rowOrientation") as GridRecipe["rowOrientation"],
            rotationCentreX: optionalNumber("rotationCentreX", item.source.x + (item.source.w - 1) / 2),
            rotationCentreY: optionalNumber("rotationCentreY", item.source.y + (item.source.h - 1) / 2),
            rotationTurns: rotationTurns as GridRecipe["rotationTurns"],
        };
        if (gridRecipeError(recipe) !== null) throw invalidFile();
        return recipe;
    });
    return recipes;
}

function writeRecipes(recipes: ReadonlyArray<GridRecipe> = []): McwV3["recipes"] {
    const checked = readRecipes(recipes.map(recipe => ({ ...recipe, source: {
        ...recipe.source,
        mask: packMask(recipe.source.mask),
    } })));
    return checked.map(recipe => ({ ...recipe, source: { ...recipe.source, mask: packMask(recipe.source.mask) } }));
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
    if (!isRecord(data.state) || typeof data.colorA !== "string" || typeof data.colorB !== "string") {
        throw invalidFile();
    }
    const pattern = data.state as unknown as PatternState;
    assertPatternDimensions(pattern);
    return { pattern, colorA: data.colorA, colorB: data.colorB };
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
    if (document.pixels.length !== document.pattern.canvasWidth * document.pattern.canvasHeight
        || typeof document.colorA !== "string" || typeof document.colorB !== "string") {
        throw invalidFile();
    }
    const file: McwV3 = {
        version: MCW_VERSION,
        state: document.pattern,
        pixels: packPixels(document.pixels),
        colorA: document.colorA,
        colorB: document.colorB,
        axes: readAxes(document.axes, document.pattern),
        recipes: writeRecipes(document.recipes),
    };
    return JSON.stringify(file);
}

export function decodeMcw(source: string): ProjectDocument {
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
    if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== MCW_VERSION) throw invalidFile();

    const common = readCommon(parsed);
    const expectedLength = common.pattern.canvasWidth * common.pattern.canvasHeight;
    if (parsed.version === 1) {
        if (!Array.isArray(parsed.pixels) || parsed.pixels.length !== expectedLength
            || !parsed.pixels.every(pixel => Number.isInteger(pixel) && pixel >= 0 && pixel <= 2)) {
            throw invalidFile();
        }
        return { ...common, pixels: new Uint8Array(parsed.pixels), axes: [], recipes: [] };
    }
    if (typeof parsed.pixels !== "string") throw invalidFile();
    try {
        const recipes = parsed.version === 3 ? readRecipes(parsed.recipes) : [];
        return {
            ...common,
            pixels: unpackPixels(parsed.pixels, common.pattern),
            axes: parsed.version === 3 ? readAxes(parsed.axes, common.pattern) : [],
            recipes,
        };
    } catch {
        throw invalidFile();
    }
}
