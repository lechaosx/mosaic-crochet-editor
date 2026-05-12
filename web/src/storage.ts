import { initialize_row_pattern, initialize_round_pattern } from "@mosaic/wasm";
import { PatternState, Tool, SymKey } from "./types";
import { SessionState } from "./store";

const LS_KEY       = "mosaic-pattern-v2";
const FILE_VERSION = 2;
const LS_VERSION   = 2;

// In-memory pixel encoding: 0 = inner hole, 1 = COLOR_A, 2 = COLOR_B.
// On disk we pack to 1 bit per cell (A=0, B=1). Hole cells get an arbitrary
// bit; the load path rebuilds the transparent sentinel from geometry.

function u8ToB64(u8: Uint8Array): string {
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
        s += String.fromCharCode(...u8.subarray(i, i + chunk));
    }
    return btoa(s);
}
function b64ToU8(s: string): Uint8Array {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}

export function packPixels(pixels: Uint8Array): string {
    const out = new Uint8Array(Math.ceil(pixels.length / 8));
    for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] === 2) out[i >> 3] |= 1 << (i & 7);
    }
    return u8ToB64(out);
}
// Start from a fresh natural-colour pattern (which already encodes hole
// positions as 0) and overwrite non-hole cells with the saved A/B bit. This
// keeps the hole geometry as a single Rust-side source of truth — no TS-side
// reimplementation of `get_round_from_edge`.
export function unpackPixels(s: string, state: PatternState): Uint8Array {
    const out = state.mode === "row"
        ? initialize_row_pattern(state.canvasWidth, state.canvasHeight)
        : initialize_round_pattern(
              state.canvasWidth, state.canvasHeight,
              state.virtualWidth, state.virtualHeight,
              state.offsetX, state.offsetY, state.rounds,
          );
    const packed = b64ToU8(s);
    for (let i = 0; i < out.length; i++) {
        if (out[i] !== 0) {
            out[i] = ((packed[i >> 3] >> (i & 7)) & 1) ? 2 : 1;
        }
    }
    return out;
}

// ── BC v1 → v2 ───────────────────────────────────────────────────────────────
// v1 stored pixels as `number[]` using the same 0/1/2 in-memory encoding.
// We only need to wrap it as a Uint8Array.
function unpackPixelsV1(old: number[]): Uint8Array {
    return new Uint8Array(old);
}

// ── localStorage (session persistence) ───────────────────────────────────────

interface LocalSaveV2 {
    version:        2;
    state:          PatternState;
    pixels:         string;   // packed
    colorA:         string;
    colorB:         string;
    activeTool:     string;
    primaryColor:   number;
    symmetry:       string[];
    hlOpacity:      number;
    labelsVisible:  boolean;
    lockInvalid:    boolean;
    canvasRotation: number;
}

// BC: v1 LocalSave (no `version` field, pixels as number[])
interface LocalSaveV1 {
    state:          PatternState;
    pixels:         number[];
    colorA:         string;
    colorB:         string;
    activeTool:     string;
    primaryColor:   number;
    symmetry:       string[];
    hlOverlayColor: string;
    hlInvalidColor: string;
    hlOpacity:      number;
    labelsVisible?: boolean;
    hlSymbols?:     boolean;
    canvasRotation: number;
}

export function saveToLocalStorage(s: Readonly<SessionState>) {
    const data: LocalSaveV2 = {
        version: LS_VERSION,
        state:          s.pattern,
        pixels:         packPixels(s.pixels),
        colorA:         s.colorA,
        colorB:         s.colorB,
        activeTool:     s.activeTool,
        primaryColor:   s.primaryColor,
        symmetry:       [...s.symmetry],
        hlOpacity:      s.hlOpacity,
        labelsVisible:  s.labelsVisible,
        lockInvalid:    s.lockInvalid,
        canvasRotation: s.rotation,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
}

export function loadFromLocalStorage(): SessionState | null {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return null;
    try {
        const data = JSON.parse(saved) as LocalSaveV2 | LocalSaveV1;
        if (!data.state) return null;

        // Backward-compatibility: v1 had no `version` field; pixels was number[].
        const isV1 = !("version" in data);
        const pixels = isV1
            ? unpackPixelsV1((data as LocalSaveV1).pixels)
            : unpackPixels((data as LocalSaveV2).pixels, data.state);

        return {
            pattern:       data.state,
            pixels,
            colorA:        data.colorA         ?? "#000000",
            colorB:        data.colorB         ?? "#ffffff",
            activeTool:    (data.activeTool    ?? "pencil") as Tool,
            primaryColor:  (data.primaryColor  ?? 1) as 1 | 2,
            symmetry:      new Set((data.symmetry ?? []) as SymKey[]),
            hlOpacity:     data.hlOpacity      ?? 100,
            labelsVisible: data.labelsVisible  ?? true,
            lockInvalid:   ("lockInvalid" in data ? data.lockInvalid : false) ?? false,
            rotation:      data.canvasRotation ?? 0,
        };
    } catch { localStorage.removeItem(LS_KEY); return null; }
}

// ── File save / load ──────────────────────────────────────────────────────────

interface SaveFileV2 {
    version: 2;
    state:   PatternState;
    pixels:  string;        // packed
    colorA:  string;
    colorB:  string;
}

// BC: v1 .mcw files
interface SaveFileV1 {
    version: 1;
    state:   PatternState;
    pixels:  number[];
    colorA:  string;
    colorB:  string;
}

export async function saveToFile(s: Readonly<SessionState>): Promise<boolean> {
    const file: SaveFileV2 = {
        version: FILE_VERSION, state: s.pattern, pixels: packPixels(s.pixels),
        colorA: s.colorA, colorB: s.colorB,
    };
    const json = JSON.stringify(file);

    if ("showSaveFilePicker" in window) {
        try {
            const handle = await (window as unknown as {
                showSaveFilePicker: (opts: object) => Promise<{
                    createWritable: () => Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }>
                }>
            }).showSaveFilePicker({
                suggestedName: "pattern.mcw",
                types: [{ description: "Mosaic Crochet Pattern", accept: { "application/json": [".mcw"] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(json);
            await writable.close();
            return true;
        } catch { return false; }
    } else {
        const blob = new Blob([json], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        Object.assign(document.createElement("a"), { href: url, download: "pattern.mcw" }).click();
        URL.revokeObjectURL(url);
        return true;
    }
}

export interface LoadedFile {
    pattern: PatternState;
    pixels:  Uint8Array;
    colorA:  string;
    colorB:  string;
}

export function loadFromFile(): Promise<LoadedFile | null> {
    return new Promise(resolve => {
        const input = Object.assign(document.createElement("input"), { type: "file", accept: ".mcw,application/json" });
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result as string) as SaveFileV2 | SaveFileV1;
                    const pixels = data.version === 2
                        ? unpackPixels(data.pixels, data.state)
                        : unpackPixelsV1(data.pixels);
                    resolve({ pattern: data.state, pixels, colorA: data.colorA, colorB: data.colorB });
                } catch { resolve(null); }
            };
            reader.readAsText(file);
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}
