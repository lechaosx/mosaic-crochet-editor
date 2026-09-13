import { PatternState, Tool, Axis, RepeatGrid } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";
import { decodeMcw, encodeMcw, McwDocument } from "@mosaic/logic/mcw";
import { defaultAxes } from "@mosaic/logic/symmetry";
import { assertPatternDimensions } from "@mosaic/logic/pattern";
import { assertRepeatGrid, defaultRepeatGrid } from "@mosaic/logic/repeat";

const LS_KEY       = "mosaic-pattern-v4";
const LS_VERSION   = 4;

interface LocalSaveV4 {
    version:          4;
    state:            PatternState;
    pixels:           string;
    colorA:           string;
    colorB:           string;
    activeTool:       string;
    primaryColor:     number;
    axes:             Axis[];
    repeat?:          RepeatGrid;
    liveTransforms?:  boolean;
    hlOpacity:        number;
    invalidIntensity: number;
    float:            PackedFloat | null;
    labelsVisible:    boolean;
    lockInvalid:      boolean;
    canvasRotation:   number;
}

export function saveToLocalStorage(s: Readonly<SessionState>) {
    const data: LocalSaveV4 = {
        version:          LS_VERSION,
        state:            s.pattern,
        pixels:           packPixels(s.pixels),
        colorA:           s.colorA,
        colorB:           s.colorB,
        activeTool:       s.activeTool,
        primaryColor:     s.primaryColor,
        axes:             s.axes,
        repeat:           s.repeat,
        liveTransforms:   s.liveTransforms,
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
        const data = JSON.parse(saved) as LocalSaveV4;
        if (!data || data.version !== LS_VERSION || !data.state) return null;
        assertPatternDimensions(data.state);
        const repeat = data.repeat ?? defaultRepeatGrid();
        assertRepeatGrid(repeat);
        return {
            pattern:          data.state,
            pixels:           unpackPixels(data.pixels, data.state),
            colorA:           data.colorA,
            colorB:           data.colorB,
            activeTool:       data.activeTool as Tool,
            primaryColor:     data.primaryColor as 1 | 2,
            axes:             data.axes ?? defaultAxes(data.state.canvasWidth, data.state.canvasHeight),
            repeat,
            liveTransforms:   data.liveTransforms ?? true,
            hlOpacity:        data.hlOpacity,
            invalidIntensity: data.invalidIntensity,
            float:            data.float ? unpackFloat(data.float) : null,
            labelsVisible:    data.labelsVisible,
            lockInvalid:      data.lockInvalid,
            rotation:         data.canvasRotation,
        };
    } catch { localStorage.removeItem(LS_KEY); return null; }
}

// ── File save / load ──────────────────────────────────────────────────────────

export type LoadedFile = McwDocument;

export async function saveToFile(s: Readonly<SessionState>): Promise<boolean> {
    const json = encodeMcw(s);

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
    return new Promise((resolve, reject) => {
        const input = Object.assign(document.createElement("input"), { type: "file", accept: ".mcw,application/json" });
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    resolve(decodeMcw(reader.result as string));
                } catch (error) {
                    reject(error instanceof Error ? error : new Error("Invalid pattern file."));
                }
            };
            reader.readAsText(file);
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}
