import { el } from "./dom";
import { PatternState } from "./types";

const LS_KEY       = "mosaic-pattern-v2";
const FILE_VERSION = 1;

// ── localStorage (session persistence) ───────────────────────────────────────

interface LocalSave {
    state:               PatternState;
    pixels:              number[];
    colorA:              string;
    colorB:              string;
    activeTool:          string;
    primaryColor:        number;
    symmetry:            string[];
    hlOverlayColor: string;
    hlInvalidColor: string;
    hlOpacity:      number;
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
    canvasRotation: number;
}

export function saveToLocalStorage(
    state: PatternState, pixels: Uint8Array,
    colorA: string, colorB: string,
    activeTool: string, primaryColor: number, symmetry: string[],
    hlOverlayColor: string, hlInvalidColor: string, hlOpacity: number,
    canvasRotation: number,
) {
    const data: LocalSave = {
        state, pixels: Array.from(pixels), colorA, colorB,
        activeTool, primaryColor, symmetry,
        hlOverlayColor, hlInvalidColor, hlOpacity, canvasRotation,
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
            canvasRotation: data.canvasRotation ?? 0,
        };
    } catch { localStorage.removeItem(LS_KEY); return null; }
}

// Sync DOM inputs with current state so the New Pattern widget shows correct values
export function syncUiToState(state: PatternState) {
    (el<HTMLSelectElement>("mode")).value = state.mode;
    el("row-controls").hidden   = state.mode !== "row";
    el("round-controls").hidden = state.mode !== "round";

    if (state.mode === "row") {
        (el<HTMLInputElement>("width")).value  = String(state.canvasWidth);
        (el<HTMLInputElement>("height")).value = String(state.canvasHeight);
    } else {
        const innerWidth  = state.virtualWidth  - state.rounds * 2;
        const innerHeight = state.virtualHeight - state.rounds * 2;
        const subMode = state.offsetX === 0 && state.offsetY === 0
            ? "full"
            : state.canvasWidth === state.virtualWidth ? "half" : "quarter";
        (el<HTMLSelectElement>("sub-mode")).value    = subMode;
        (el<HTMLInputElement>("inner-width")).value  = String(innerWidth);
        (el<HTMLInputElement>("inner-height")).value = String(innerHeight);
        (el<HTMLInputElement>("rounds")).value       = String(state.rounds);
    }
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
            const handle = await (window as any).showSaveFilePicker({
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
