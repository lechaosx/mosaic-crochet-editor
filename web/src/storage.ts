import { initialize_row_pattern, initialize_round_pattern } from "@mosaic/wasm";
import { PatternState, Tool, SymKey, Float } from "./types";
import { SessionState } from "./store";

const LS_KEY       = "mosaic-pattern-v3";
// `.mcw` schema is unchanged from v2 (pattern + pixels + colours); floats
// are never persisted to file (the user anchors them before save). The
// localStorage version bump (v3) is only because that buffer now includes
// the in-memory float for cross-refresh continuity.
const FILE_VERSION = 2;
const LS_VERSION   = 3;

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

// 1 bit per cell — pure boolean mask, no hole sentinel. Used for the float's
// mask on the wire (same shape the old selection bitset had).
export function packSelection(sel: Uint8Array): string {
    const out = new Uint8Array(Math.ceil(sel.length / 8));
    for (let i = 0; i < sel.length; i++) {
        if (sel[i]) out[i >> 3] |= 1 << (i & 7);
    }
    return u8ToB64(out);
}
export function unpackSelection(s: string, length: number): Uint8Array {
    const packed = b64ToU8(s);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        out[i] = (packed[i >> 3] >> (i & 7)) & 1;
    }
    return out;
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

// Float (mask + lifted pixels + offset) → serialised form. Stored alongside
// session pixels in localStorage and inside undo snapshots. The lifted
// pixels are 1-bit-packed using the same A=0/B=1 convention as `packPixels`,
// but only cells where `mask` is set are meaningful on read.
export interface PackedFloat {
    mask:   string;
    pixels: string;
    dx:     number;
    dy:     number;
}
export function packFloat(f: Float): PackedFloat {
    return { mask: packSelection(f.mask), pixels: packPixels(f.pixels), dx: f.dx, dy: f.dy };
}
export function unpackFloat(p: PackedFloat, length: number): Float {
    const mask   = unpackSelection(p.mask, length);
    // Lifted pixels are A/B only — holes can't be lifted (selection skips them).
    const packed = b64ToU8(p.pixels);
    const pixels = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        if (mask[i]) pixels[i] = ((packed[i >> 3] >> (i & 7)) & 1) ? 2 : 1;
    }
    return { mask, pixels, dx: p.dx, dy: p.dy };
}

// ── localStorage (session persistence) ───────────────────────────────────────

interface LocalSaveV3 {
    version:          3;
    state:            PatternState;
    pixels:           string;   // packed
    colorA:           string;
    colorB:           string;
    activeTool:       string;
    primaryColor:     number;
    symmetry:         string[];
    hlOpacity:        number;
    invalidIntensity: number;
    float:            PackedFloat | null;
    labelsVisible:    boolean;
    lockInvalid:      boolean;
    canvasRotation:   number;
}

export function saveToLocalStorage(s: Readonly<SessionState>) {
    const data: LocalSaveV3 = {
        version:          LS_VERSION,
        state:            s.pattern,
        pixels:           packPixels(s.pixels),
        colorA:           s.colorA,
        colorB:           s.colorB,
        activeTool:       s.activeTool,
        primaryColor:     s.primaryColor,
        symmetry:         [...s.symmetry],
        hlOpacity:        s.hlOpacity,
        invalidIntensity: s.invalidIntensity,
        float:            s.float ? packFloat(s.float) : null,
        labelsVisible:    s.labelsVisible,
        lockInvalid:      s.lockInvalid,
        canvasRotation:   s.rotation,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
}

export function loadFromLocalStorage(): SessionState | null {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return null;
    try {
        const data = JSON.parse(saved) as LocalSaveV3;
        if (!data || data.version !== LS_VERSION || !data.state) return null;
        const cells = data.state.canvasWidth * data.state.canvasHeight;
        return {
            pattern:          data.state,
            pixels:           unpackPixels(data.pixels, data.state),
            colorA:           data.colorA,
            colorB:           data.colorB,
            activeTool:       data.activeTool as Tool,
            primaryColor:     data.primaryColor as 1 | 2,
            symmetry:         new Set(data.symmetry as SymKey[]),
            hlOpacity:        data.hlOpacity,
            invalidIntensity: data.invalidIntensity,
            float:            data.float ? unpackFloat(data.float, cells) : null,
            labelsVisible:    data.labelsVisible,
            lockInvalid:      data.lockInvalid,
            rotation:         data.canvasRotation,
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

// ── BC v1 → v2 ───────────────────────────────────────────────────────────────
// v1 .mcw files stored pixels as `number[]` in the in-memory 0/1/2 encoding.
// Load-only; we always write v2.
interface SaveFileV1 {
    version: 1;
    state:   PatternState;
    pixels:  number[];
    colorA:  string;
    colorB:  string;
}
function unpackPixelsV1(old: number[]): Uint8Array {
    return new Uint8Array(old);
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
                    if (!data || (data.version !== 2 && data.version !== 1)) { resolve(null); return; }
                    const pixels = data.version === 2
                        ? unpackPixels(data.pixels, data.state)
                        : unpackPixelsV1(data.pixels);
                    resolve({
                        pattern: data.state,
                        pixels,
                        colorA:  data.colorA,
                        colorB:  data.colorB,
                    });
                } catch { resolve(null); }
            };
            reader.readAsText(file);
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}
