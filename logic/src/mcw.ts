import { assertPatternDimensions } from "./pattern";
import { packPixels, unpackPixels } from "./storage";
import type { PatternState } from "./types";

export const MCW_VERSION = 2;

export interface McwDocument {
    pattern: PatternState;
    pixels:  Uint8Array;
    colorA:  string;
    colorB:  string;
}

interface McwV2 {
    version: 2;
    state:   PatternState;
    pixels:  string;
    colorA:  string;
    colorB:  string;
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

export function encodeMcw(document: Readonly<McwDocument>): string {
    assertPatternDimensions(document.pattern);
    if (document.pixels.length !== document.pattern.canvasWidth * document.pattern.canvasHeight
        || typeof document.colorA !== "string" || typeof document.colorB !== "string") {
        throw invalidFile();
    }
    const file: McwV2 = {
        version: MCW_VERSION,
        state: document.pattern,
        pixels: packPixels(document.pixels),
        colorA: document.colorA,
        colorB: document.colorB,
    };
    return JSON.stringify(file);
}

export function decodeMcw(source: string): McwDocument {
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
    if (parsed.version !== 1 && parsed.version !== MCW_VERSION) throw invalidFile();

    const common = readCommon(parsed);
    const expectedLength = common.pattern.canvasWidth * common.pattern.canvasHeight;
    if (parsed.version === 1) {
        if (!Array.isArray(parsed.pixels) || parsed.pixels.length !== expectedLength
            || !parsed.pixels.every(pixel => Number.isInteger(pixel) && pixel >= 0 && pixel <= 2)) {
            throw invalidFile();
        }
        return { ...common, pixels: new Uint8Array(parsed.pixels) };
    }
    if (typeof parsed.pixels !== "string") throw invalidFile();
    try {
        return { ...common, pixels: unpackPixels(parsed.pixels, common.pattern) };
    } catch {
        throw invalidFile();
    }
}
