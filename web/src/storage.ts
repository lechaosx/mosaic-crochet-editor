import { PatternState } from "./types";

const LS_KEY       = "mosaic-pattern-v2";
const FILE_VERSION = 1;

// ── localStorage (session persistence) ───────────────────────────────────────

interface LocalSave {
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
    labelsVisible:  boolean;
    hlSymbols:      boolean;
    canvasRotation: number;
}

export interface LocalState {
    state:          PatternState;
    pixels:         Uint8Array;
    colorA:         string;
    colorB:         string;
    activeTool:     string;
    primaryColor:   number;
    symmetry:       string[];
    hlOverlayColor: string;
    hlInvalidColor: string;
    hlOpacity:      number;
    labelsVisible:  boolean;
    hlSymbols:      boolean;
    canvasRotation: number;
}

export function saveToLocalStorage(
    state: PatternState, pixels: Uint8Array,
    colorA: string, colorB: string,
    activeTool: string, primaryColor: number, symmetry: string[],
    hlOverlayColor: string, hlInvalidColor: string, hlOpacity: number,
    labelsVisible: boolean, hlSymbols: boolean,
    canvasRotation: number,
) {
    const data: LocalSave = {
        state, pixels: Array.from(pixels), colorA, colorB,
        activeTool, primaryColor, symmetry,
        hlOverlayColor, hlInvalidColor, hlOpacity,
        labelsVisible, hlSymbols, canvasRotation,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
}

export function loadFromLocalStorage(): LocalState | null {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return null;
    try {
        const data: LocalSave = JSON.parse(saved);
        if (!data.state || !data.pixels) return null;
        return {
            state:          data.state,
            pixels:         new Uint8Array(data.pixels),
            colorA:         data.colorA         ?? "#000000",
            colorB:         data.colorB         ?? "#ffffff",
            activeTool:     data.activeTool     ?? "pencil",
            primaryColor:   data.primaryColor   ?? 1,
            symmetry:       data.symmetry       ?? [],
            hlOverlayColor: data.hlOverlayColor ?? "#0000ff",
            hlInvalidColor: data.hlInvalidColor ?? "#ff0000",
            hlOpacity:      data.hlOpacity      ?? 50,
            labelsVisible:  data.labelsVisible  ?? true,
            hlSymbols:      data.hlSymbols      ?? true,
            canvasRotation: data.canvasRotation ?? 0,
        };
    } catch { localStorage.removeItem(LS_KEY); return null; }
}

// ── File save / load ──────────────────────────────────────────────────────────

interface SaveFile {
    version: number;
    state:   PatternState;
    pixels:  number[];
    colorA:  string;
    colorB:  string;
}

export async function saveToFile(state: PatternState, pixels: Uint8Array, colorA: string, colorB: string): Promise<boolean> {
    const file: SaveFile = { version: FILE_VERSION, state, pixels: Array.from(pixels), colorA, colorB };
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

export function loadFromFile(): Promise<{ state: PatternState; pixels: Uint8Array; colorA: string; colorB: string } | null> {
    return new Promise(resolve => {
        const input = Object.assign(document.createElement("input"), { type: "file", accept: ".mcw,application/json" });
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data: SaveFile = JSON.parse(reader.result as string);
                    resolve({ state: data.state, pixels: new Uint8Array(data.pixels), colorA: data.colorA, colorB: data.colorB });
                } catch { resolve(null); }
            };
            reader.readAsText(file);
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}
