import { PatternState, Tool, Axis, GridRecipe } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";
import { decodeMcw, encodeMcw, ProjectDocument } from "@mosaic/logic/mcw";
import { axisIsProjectValid, defaultAxes } from "@mosaic/logic/symmetry";
import { assertPatternDimensions } from "@mosaic/logic/pattern";
import { normalizeActiveRecipeId, restoreGridRecipes, storedGridRecipes } from "@mosaic/logic/grid-recipes";
import {
    AppPreferences,
    DEFAULT_APP_PREFERENCES,
    hasStoredAppPreferences,
    saveAppPreferences,
} from "./preferences";

const RECOVERY_KEY        = "mosaic-recovery";
const LEGACY_RECOVERY_KEY = "mosaic-pattern-v4";
const RECOVERY_VERSION    = 6;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function recoveryColorOverride(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !HEX_COLOR.test(value)) throw new TypeError("Invalid recovery colour.");
    return value;
}

function recoveryYarnColor(value: unknown): string {
    if (typeof value !== "string" || !HEX_COLOR.test(value)) throw new TypeError("Invalid recovery colour.");
    return value;
}

interface LocalSaveV4 {
    version:          4;
    state:            PatternState;
    pixels:           string;
    colorA:           string;
    colorB:           string;
    activeTool:       string;
    primaryColor:     number;
    axes:             Axis[];
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
        recipes?:        unknown[];
        activeRecipeId?: string | null;
        liveTransforms?: boolean;
        float:           PackedFloat | null;
    };
    preferences: {
        hlOpacity:        number;
        showGuidance?:     boolean;
        invalidIntensity: number;
        labelsVisible:    boolean;
        lockInvalid:      boolean;
        canvasRotation:   number;
    };
}

interface RecoveryV6 {
    version: 6;
    document: RecoveryV5["document"] & {
        dangerColorOverride?: string | null;
        accentColorOverride?: string | null;
    };
    workspace: RecoveryV5["workspace"] & { rotation: number };
}

interface MigratedRecovery {
    recovery: RecoveryV6;
    preferences?: AppPreferences;
}

function preferencesFromLegacy(preferences: RecoveryV5["preferences"]): AppPreferences {
    return {
        guidanceOpacity: preferences.showGuidance === false ? 0 : preferences.hlOpacity,
        dangerColor: DEFAULT_APP_PREFERENCES.dangerColor,
        accentColor: DEFAULT_APP_PREFERENCES.accentColor,
        labelsVisible: preferences.labelsVisible,
        lockInvalid: preferences.lockInvalid,
    };
}

function recoveryFromV4(data: LocalSaveV4): RecoveryV5 {
    return {
        version: 5,
        document: {
            state: data.state, pixels: data.pixels,
            colorA: data.colorA, colorB: data.colorB,
        },
        workspace: {
            activeTool: data.activeTool, primaryColor: data.primaryColor,
            axes: data.axes,
            liveTransforms: data.liveTransforms, float: data.float,
        },
        preferences: {
            hlOpacity: data.hlOpacity, invalidIntensity: data.invalidIntensity,
            labelsVisible: data.labelsVisible, lockInvalid: data.lockInvalid,
            canvasRotation: data.canvasRotation,
        },
    };
}

function recoveryFromV5(data: RecoveryV5): MigratedRecovery {
    return {
        recovery: {
            version: RECOVERY_VERSION,
            document: data.document,
            workspace: {
                ...data.workspace,
                rotation: data.preferences.canvasRotation,
            },
        },
        preferences: preferencesFromLegacy(data.preferences),
    };
}

function migrateRecovery(value: unknown): MigratedRecovery | null {
    if (typeof value !== "object" || value === null) return null;
    const data = value as Record<string, unknown>;
    if (data.version === RECOVERY_VERSION) {
        if (typeof data.document !== "object" || data.document === null
            || typeof data.workspace !== "object" || data.workspace === null) return null;
        return { recovery: data as unknown as RecoveryV6 };
    }
    if (data.version === 5) {
        if (typeof data.document !== "object" || data.document === null
            || typeof data.workspace !== "object" || data.workspace === null
            || typeof data.preferences !== "object" || data.preferences === null) return null;
        return recoveryFromV5(data as unknown as RecoveryV5);
    }
    if (data.version === 4 && data.state) {
        return recoveryFromV5(recoveryFromV4(data as unknown as LocalSaveV4));
    }
    return null;
}

function recoveryFromSession(s: Readonly<SessionState>): RecoveryV6 {
    return {
        version: RECOVERY_VERSION,
        document: {
            state: s.pattern, pixels: packPixels(s.pixels),
            colorA: recoveryYarnColor(s.colorA), colorB: recoveryYarnColor(s.colorB),
            dangerColorOverride: s.dangerColorOverride,
            accentColorOverride: s.accentColorOverride,
        },
        workspace: {
            activeTool: s.activeTool, primaryColor: s.primaryColor,
            axes: s.axes,
            recipes: storedGridRecipes(s.recipes), activeRecipeId: s.activeRecipeId,
            liveTransforms: s.liveMirrors,
            float: s.float ? packFloat(s.float) : null,
            rotation: s.rotation,
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
        const parsed: unknown = JSON.parse(saved);
        const migrated = migrateRecovery(parsed);
        if (!migrated) return null;
        const { recovery, preferences } = migrated;
        const { document, workspace } = recovery;
        assertPatternDimensions(document.state);
        const axes = workspace.axes ?? defaultAxes(
            document.state.canvasWidth, document.state.canvasHeight,
        );
        const recipes = restoreGridRecipes(workspace.recipes);
        const float = workspace.float ? unpackFloat(workspace.float) : null;
        const restored: SessionState = {
            pattern:          document.state,
            pixels:           unpackPixels(document.pixels, document.state),
            colorA:           recoveryYarnColor(document.colorA),
            colorB:           recoveryYarnColor(document.colorB),
            dangerColorOverride: recoveryColorOverride(document.dangerColorOverride),
            accentColorOverride: recoveryColorOverride(document.accentColorOverride),
            activeTool:       workspace.activeTool as Tool,
            primaryColor:     workspace.primaryColor as 1 | 2,
            axes:             axes.filter(axis => axisIsProjectValid(axis, document.state)),
            recipes,
            activeRecipeId:   normalizeActiveRecipeId(
                recipes,
                typeof workspace.activeRecipeId === "string" ? workspace.activeRecipeId : null,
                float,
            ),
            liveMirrors:      workspace.liveTransforms ?? true,
            float,
            rotation:         workspace.rotation ?? 0,
        };
        if (preferences && !hasStoredAppPreferences()) saveAppPreferences(preferences);
        if (sourceKey === LEGACY_RECOVERY_KEY
            || recovery.version !== (parsed as { version?: number }).version) {
            try {
                localStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery));
                localStorage.removeItem(LEGACY_RECOVERY_KEY);
            } catch {
                return restored;
            }
        }
        return restored;
    } catch { localStorage.removeItem(sourceKey); return null; }
}

// ── File save / load ──────────────────────────────────────────────────────────

export type LoadedFile = ProjectDocument;

function projectDocumentFrom(s: Readonly<SessionState>): ProjectDocument {
    return {
        pattern: s.pattern,
        pixels: s.pixels,
        colorA: s.colorA,
        colorB: s.colorB,
        axes: s.axes,
        recipes: s.recipes,
        dangerColorOverride: s.dangerColorOverride,
        accentColorOverride: s.accentColorOverride,
    };
}

export async function saveToFile(s: Readonly<SessionState>): Promise<boolean> {
    const json = encodeMcw(projectDocumentFrom(s));

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
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return false;
            throw error;
        }
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
            reader.onerror = () => reject(new Error("Could not read pattern file."));
            reader.readAsText(file);
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}
