import { PatternState, Tool, Axis, RepeatGrid } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";
import { decodeMcw, encodeMcw, McwDocument } from "@mosaic/logic/mcw";
import { defaultAxes } from "@mosaic/logic/symmetry";
import { assertPatternDimensions } from "@mosaic/logic/pattern";
import { assertRepeatGrid, defaultRepeatGrid } from "@mosaic/logic/repeat";

const RECOVERY_KEY        = "mosaic-recovery";
const LEGACY_RECOVERY_KEY = "mosaic-pattern-v4";
const RECOVERY_VERSION    = 5;

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

interface RecoveryV5 {
    version: 5;
    document: {
        state:  PatternState;
        pixels: string;
        colorA: string;
        colorB: string;
    };
    workspace: {
        activeTool:      string;
        primaryColor:    number;
        axes:            Axis[];
        repeat?:         RepeatGrid;
        liveTransforms?: boolean;
        float:           PackedFloat | null;
    };
    preferences: {
        hlOpacity:        number;
        invalidIntensity: number;
        labelsVisible:    boolean;
        lockInvalid:      boolean;
        canvasRotation:   number;
    };
}

function recoveryFromV4(data: LocalSaveV4): RecoveryV5 {
    return {
        version: RECOVERY_VERSION,
        document: {
            state: data.state, pixels: data.pixels,
            colorA: data.colorA, colorB: data.colorB,
        },
        workspace: {
            activeTool: data.activeTool, primaryColor: data.primaryColor,
            axes: data.axes, repeat: data.repeat,
            liveTransforms: data.liveTransforms, float: data.float,
        },
        preferences: {
            hlOpacity: data.hlOpacity, invalidIntensity: data.invalidIntensity,
            labelsVisible: data.labelsVisible, lockInvalid: data.lockInvalid,
            canvasRotation: data.canvasRotation,
        },
    };
}

function migrateRecovery(value: unknown): RecoveryV5 | null {
    if (typeof value !== "object" || value === null) return null;
    const data = value as Record<string, unknown>;
    if (data.version === RECOVERY_VERSION) {
        if (typeof data.document !== "object" || data.document === null
            || typeof data.workspace !== "object" || data.workspace === null
            || typeof data.preferences !== "object" || data.preferences === null) return null;
        return data as unknown as RecoveryV5;
    }
    if (data.version === 4 && data.state) return recoveryFromV4(data as unknown as LocalSaveV4);
    return null;
}

function recoveryFromSession(s: Readonly<SessionState>): RecoveryV5 {
    return {
        version: RECOVERY_VERSION,
        document: {
            state: s.pattern, pixels: packPixels(s.pixels),
            colorA: s.colorA, colorB: s.colorB,
        },
        workspace: {
            activeTool: s.activeTool, primaryColor: s.primaryColor,
            axes: s.axes, repeat: s.repeat,
            liveTransforms: s.liveTransforms,
            float: s.float ? packFloat(s.float) : null,
        },
        preferences: {
            hlOpacity: s.hlOpacity, invalidIntensity: s.invalidIntensity,
            labelsVisible: s.labelsVisible, lockInvalid: s.lockInvalid,
            canvasRotation: s.rotation,
        },
    };
}

export function saveToLocalStorage(s: Readonly<SessionState>): boolean {
    try {
        localStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryFromSession(s)));
        localStorage.removeItem(LEGACY_RECOVERY_KEY);
        return true;
    } catch {
        return false;
    }
}

export function loadFromLocalStorage(): SessionState | null {
    const current = localStorage.getItem(RECOVERY_KEY);
    const sourceKey = current === null ? LEGACY_RECOVERY_KEY : RECOVERY_KEY;
    const saved = current ?? localStorage.getItem(LEGACY_RECOVERY_KEY);
    if (!saved) return null;
    try {
        const data = migrateRecovery(JSON.parse(saved));
        if (!data) return null;
        const { document, workspace, preferences } = data;
        assertPatternDimensions(document.state);
        const repeat = workspace.repeat ?? defaultRepeatGrid();
        assertRepeatGrid(repeat);
        const restored: SessionState = {
            pattern:          document.state,
            pixels:           unpackPixels(document.pixels, document.state),
            colorA:           document.colorA,
            colorB:           document.colorB,
            activeTool:       workspace.activeTool as Tool,
            primaryColor:     workspace.primaryColor as 1 | 2,
            axes:             workspace.axes ?? defaultAxes(document.state.canvasWidth, document.state.canvasHeight),
            repeat,
            liveTransforms:   workspace.liveTransforms ?? true,
            hlOpacity:        preferences.hlOpacity,
            invalidIntensity: preferences.invalidIntensity,
            float:            workspace.float ? unpackFloat(workspace.float) : null,
            labelsVisible:    preferences.labelsVisible,
            lockInvalid:      preferences.lockInvalid,
            rotation:         preferences.canvasRotation,
        };
        if (sourceKey === LEGACY_RECOVERY_KEY) {
            try {
                localStorage.setItem(RECOVERY_KEY, JSON.stringify(data));
                localStorage.removeItem(LEGACY_RECOVERY_KEY);
            } catch {
                return restored;
            }
        }
        return restored;
    } catch { localStorage.removeItem(sourceKey); return null; }
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
