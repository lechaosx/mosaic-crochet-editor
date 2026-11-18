import { PatternState, Tool, ToolVariants, MirrorCenter } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";
import { decodeMcwWithMigration, encodeMcw, ProjectDocument } from "@mosaic/logic/mcw";
import { mirrorsForPattern, readMirrorRecords } from "@mosaic/logic/symmetry";
import { assertPatternDimensions } from "@mosaic/logic/pattern";
import { normalizeActiveRecipeId, restoreGridRecipes, storedGridRecipes } from "@mosaic/logic/grid-recipes";

const RECOVERY_KEY     = "mosaic-recovery";
const RECOVERY_VERSION = 9;
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

interface Recovery {
    version: 9;
    document: {
        state:  PatternState;
        pixels: string;
        colorA: string;
        colorB: string;
        dangerColorOverride?: string | null;
        accentColorOverride?: string | null;
    };
    workspace: {
        activeTool:     string;
        primaryColor:   number;
        toolVariants:   ToolVariants;
        mirrors:        MirrorCenter[];
        recipes:        unknown[];
        activeRecipeId: string | null;
        float:          PackedFloat | null;
        rotation:       number;
    };
}

function recoveryFromSession(s: Readonly<SessionState>): Recovery {
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
            toolVariants: s.toolVariants,
            mirrors: s.mirrors,
            recipes: storedGridRecipes(s.recipes), activeRecipeId: s.activeRecipeId,
            float: s.float ? packFloat(s.float) : null,
            rotation: s.rotation,
        },
    };
}

export function saveToLocalStorage(s: Readonly<SessionState>): boolean {
    try {
        localStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryFromSession(s)));
        return true;
    } catch {
        return false;
    }
}

export function loadFromLocalStorage(): SessionState | null {
    const saved = localStorage.getItem(RECOVERY_KEY);
    if (!saved) return null;
    try {
        const parsed: unknown = JSON.parse(saved);
        if (typeof parsed !== "object" || parsed === null) return null;
        const recovery = parsed as Recovery;
        if (recovery.version !== RECOVERY_VERSION
            || typeof recovery.document !== "object" || recovery.document === null
            || typeof recovery.workspace !== "object" || recovery.workspace === null) return null;
        const { document, workspace } = recovery;
        assertPatternDimensions(document.state);
        const mirrors = readMirrorRecords(workspace.mirrors);
        if (!mirrors) return null;
        const recipes = restoreGridRecipes(workspace.recipes, false);
        if (!Array.isArray(workspace.recipes)
            || (workspace.recipes.length > 0 && recipes.length !== workspace.recipes.length)) throw new TypeError("Invalid recovered selections.");
        const float = workspace.float ? unpackFloat(workspace.float) : null;
        return {
            pattern:          document.state,
            pixels:           unpackPixels(document.pixels, document.state),
            colorA:           recoveryYarnColor(document.colorA),
            colorB:           recoveryYarnColor(document.colorB),
            dangerColorOverride: recoveryColorOverride(document.dangerColorOverride),
            accentColorOverride: recoveryColorOverride(document.accentColorOverride),
            activeTool:       workspace.activeTool as Tool,
            toolVariants:    recoveryToolVariants(workspace.toolVariants),
            primaryColor:     workspace.primaryColor as 1 | 2,
            mirrors:          mirrorsForPattern(mirrors, document.state),
            recipes,
            activeRecipeId:   normalizeActiveRecipeId(
                recipes,
                typeof workspace.activeRecipeId === "string" ? workspace.activeRecipeId : null,
                float,
            ),
            liveMirrors:      true,
            float,
            rotation:         workspace.rotation ?? 0,
        };
    } catch { localStorage.removeItem(RECOVERY_KEY); return null; }
}

function recoveryToolVariants(value: unknown): ToolVariants {
    if (typeof value !== "object" || value === null) throw new TypeError("Invalid recovery tool variants.");
    const variants = value as ToolVariants;
    if (!["replace", "add", "remove"].includes(variants.select)
        || !["replace", "add", "remove"].includes(variants.wand)
        || !["move", "duplicate", "mask-only"].includes(variants.move)
        || !["place", "clear", "invert"].includes(variants.overlay)) throw new TypeError("Invalid recovery tool variants.");
    return { select: variants.select, wand: variants.wand, move: variants.move, overlay: variants.overlay };
}

// ── File save / load ──────────────────────────────────────────────────────────

export type LoadedFile = ProjectDocument;

function projectDocumentFrom(s: Readonly<SessionState>): ProjectDocument {
    return {
        pattern: s.pattern,
        pixels: s.pixels,
        colorA: s.colorA,
        colorB: s.colorB,
        mirrors: s.mirrors,
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

export function loadFromFile(onMigration?: () => void): Promise<LoadedFile | null> {
    return new Promise((resolve, reject) => {
        const input = Object.assign(document.createElement("input"), { type: "file", accept: ".mcw,application/json" });
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const loaded = decodeMcwWithMigration(reader.result as string);
                    if (loaded.selectionBehaviorChanged) onMigration?.();
                    resolve(loaded.project);
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
