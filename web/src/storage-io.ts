import { PatternState, Tool, ToolVariants, MirrorCenter } from "@mosaic/logic/types";
import { SessionState } from "@mosaic/logic/store";
import { packPixels, unpackPixels, packFloat, unpackFloat, PackedFloat } from "@mosaic/logic/storage";
import { decodeMcwWithMigration, encodeMcw, ProjectDocument } from "@mosaic/logic/mcw";
import { mirrorsForPattern, readMirrorRecords } from "@mosaic/logic/symmetry";
import { assertPatternDimensions } from "@mosaic/logic/pattern";
import { normalizeActiveRecipeId, restoreGridRecipes, storedGridRecipes } from "@mosaic/logic/grid-recipes";

const RECOVERY_VERSION = 9;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function recoveryColorOverride(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== "string" || !HEX_COLOR.test(value)) throw new TypeError("Invalid recovery colour.");
    return value;
}

function recoveryYarnColor(value: unknown): string {
    if (typeof value !== "string" || !HEX_COLOR.test(value)) throw new TypeError("Invalid recovery colour.");
    return value;
}

// The project's resume-editing record: its document and editor workspace.
export interface Recovery {
    version: 9;
    document: {
        state:  PatternState;
        pixels: string;
        colorA: string;
        colorB: string;
        dangerColorOverride: string | null;
        accentColorOverride: string | null;
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

export function recoveryRecord(s: Readonly<SessionState>): Recovery {
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

// Null when `value` is not a valid recovery record.
export function sessionFromRecovery(value: unknown): SessionState | null {
    if (typeof value !== "object" || value === null) return null;
    const recovery = value as Recovery;
    if (recovery.version !== RECOVERY_VERSION
        || typeof recovery.document !== "object" || recovery.document === null
        || typeof recovery.workspace !== "object" || recovery.workspace === null) return null;
    try {
        const { document, workspace } = recovery;
        assertPatternDimensions(document.state);
        const mirrors = readMirrorRecords(workspace.mirrors);
        if (!mirrors || typeof workspace.rotation !== "number") return null;
        const recipes = restoreGridRecipes(workspace.recipes, false);
        if (!Array.isArray(workspace.recipes)
            || (workspace.recipes.length > 0 && recipes.length !== workspace.recipes.length)) return null;
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
            rotation:         workspace.rotation,
        };
    } catch { return null; }
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

export interface LoadedFile {
    name:    string;
    project: ProjectDocument;
}

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

// Resolves the saved file's name, or null when the user cancels. `name` is
// suggested to the file picker, or names the download without one.
export async function saveToFile(s: Readonly<SessionState>, name: string): Promise<string | null> {
    const json = encodeMcw(projectDocumentFrom(s));

    if ("showSaveFilePicker" in window) {
        try {
            const handle = await (window as unknown as {
                showSaveFilePicker: (opts: object) => Promise<{
                    name: string;
                    createWritable: () => Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }>
                }>
            }).showSaveFilePicker({
                suggestedName: name,
                types: [{ description: "Mosaic Crochet Pattern", accept: { "application/json": [".mcw"] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(json);
            await writable.close();
            return handle.name;
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return null;
            throw error;
        }
    } else {
        const blob = new Blob([json], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        Object.assign(document.createElement("a"), { href: url, download: name }).click();
        URL.revokeObjectURL(url);
        return name;
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
                    resolve({ name: file.name, project: loaded.project });
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
