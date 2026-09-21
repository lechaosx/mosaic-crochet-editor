import { assertPatternDimensions } from "./pattern";
import { packPixels, unpackPixels } from "./storage";
import { axisIsProjectValid } from "./symmetry";
import type { Axis, PatternState } from "./types";

export const MCW_VERSION = 3;

// This is the complete editable project boundary. Workspace controls,
// selection state, app preferences, and history deliberately stay outside it.
export interface ProjectDocument {
    pattern: PatternState;
    pixels:  Uint8Array;
    colorA:  string;
    colorB:  string;
    axes:    Axis[];
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
        return { ...common, pixels: new Uint8Array(parsed.pixels), axes: [] };
    }
    if (typeof parsed.pixels !== "string") throw invalidFile();
    try {
        return {
            ...common,
            pixels: unpackPixels(parsed.pixels, common.pattern),
            axes: parsed.version === 3 ? readAxes(parsed.axes, common.pattern) : [],
        };
    } catch {
        throw invalidFile();
    }
}
