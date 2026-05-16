import { PatternState, Tool, SymKey } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";

const LS_KEY       = "mosaic-pattern-v3";
const FILE_VERSION = 2;
const LS_VERSION   = 3;

interface LocalSaveV3 {
    version:          3;
    state:            PatternState;
    pixels:           string;
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
    pixels:  string;
    colorA:  string;
    colorB:  string;
}
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

export interface LoadedFile {
    pattern: PatternState;
    pixels:  Uint8Array;
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
