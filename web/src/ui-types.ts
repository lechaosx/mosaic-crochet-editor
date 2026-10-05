import type { Tool, ToolVariants, SymKey, PatternState, MirrorCenter, GridRecipe } from "@mosaic/logic/types";
import type { ToolAction } from "@mosaic/logic/tool-input";
import type { CanvasWorkspace, InstructionSeam } from "./render";
import type { PackedInstructionCoordinates } from "./instruction-coordinates";

export type SelectionMoveMode = ToolVariants["move"];

export interface UICallbacks {
    onTool:            (t: Tool) => void;
    onToolVariant: <K extends keyof ToolVariants>(tool: K, variant: ToolVariants[K]) => void;
    onSelectionCopy:     () => void;
    onSelectionCut:      () => void;
    onSelectionPaste:    () => void;
    onSelectionDeselect: () => void;
    onPrimaryColor:    (slot: 1 | 2) => void;
    onSwapYarns:       () => void;
    onResetYarnColor:  (slot: 1 | 2) => void;
    onColorChange:     () => void;
    onColorCommit:     () => void;
    onAddMirror:       (k: SymKey | null) => void;
    onToggleMirror:    (id: string) => void;
    onDeleteMirror:    (id: string) => void;
    onSelectMirror:    (id: string) => void;
    onMirrorType:      (id: string, type: SymKey) => void;
    onMirrorPosition:  (id: string, position: { x: number; y: number }) => MirrorCenter | null;
    onCreateRecipe:    () => void;
    onActivateRecipe:  (id: string) => void;
    onDeleteRecipe:    (id: string) => void;
    onRecipeChange:    (id: string, change: Partial<GridRecipe>, preview?: boolean) => boolean;
    onRecipeCommit:    () => void;
    onRecipeRevert:    () => void;
    onApplyRecipe:     () => void;
    onTransformPopoverToggle: (open: boolean) => void;
    onReplicateSelection: () => void;
    onHighlightChange:        () => void;
    onDangerColorChange:      () => void;
    onAccentColorChange:      () => void;
    onDangerColorReset:       () => void;
    onAccentColorReset:       () => void;
    onFindContrastColors:     () => void;
    onLabelsVisibleChange:    () => void;
    onLockInvalidChange: () => void;
    onUndo:            () => void;
    onRedo:            () => void;
    onRotate:          (delta: number) => void;
    onResetRotation:   () => void;
    onFit:             () => void;
    onZoom:            (factor: number) => void;
    onNavigate:        () => void;
    onEditOpen:        () => void;
    onEditChange:      (clearDesign?: boolean) => boolean;
    onEditCommit:      (clearDesign?: boolean) => void;
    onEditRevert:      () => void;
    onSave:            () => void;
    onLoad:            () => void;
    onInstructions:    () => void;
    onAbout:           () => void;
}

export interface UIHandle {
    setTool:            (t: Tool) => void;
    setToolVariants:    (variants: ToolVariants) => void;
    setExecutingAction: (action: ToolAction | null, yarn?: 1 | 2 | null) => void;
    setSelectionState:  (selectedCount: number, clipboardCount: number) => void;
    setCanvasFeedback:  (message: string | null) => void;
    setPrimary:         (slot: 1 | 2) => void;
    setColors:          (a: string, b: string) => void;
    setProjectColors:   (danger: string, accent: string) => void;
    setMirrors:         (mirrors: ReadonlyArray<MirrorCenter>, selectedId: string | null) => void;
    setRecipes:         (recipes: ReadonlyArray<GridRecipe>, activeId: string | null) => void;
    setRecipeError:     (message: string | null) => void;
    setTransformState:  (hasSelection: boolean, hasTransforms: boolean) => void;
    setTransformError:  (message: string | null) => void;
    setHistory:         (undo: boolean, redo: boolean) => void;
    setCrochetProgress: (hasProgress: boolean) => void;
    setCrochetErrors:   (count: number) => void;
    setRecoveryStatus:  (state: "saved" | "recovered" | "failed") => void;
    setDocumentError:   (message: string | null, returnTo?: "load" | "save") => void;
    setDocumentNotice:  (message: string) => void;
    getCanvasWorkspace: () => CanvasWorkspace;
    setViewState:       (rotation: number, navigating: boolean) => void;
    setEditError:       (message: string | null) => void;
    setEditSummary:     (width: number, height: number, preserved: number, added: number, removed: number) => void;
    syncEditInputs:     (s: PatternState) => void;
    openInstructions:   () => InstructionsView;
}

export interface InstructionOverviewUnit {
    label: string;
    yarn: "A" | "B";
    color: string;
    text: string;
    invalid: boolean;
    guidanceCoords: PackedInstructionCoordinates;
    seam: Omit<InstructionSeam, "invalid"> | null;
}

export interface InstructionsView {
    setProgress: (count: number, total: number) => void;
    endProgress: () => void;
    appendLine:  (line: string) => void;
    appendUnit:  (unit: InstructionOverviewUnit) => void;
    clearText:   () => void;
    clearUnits:  () => void;
    setLivePlan: (units: readonly InstructionOverviewUnit[], completedUnits: number,
                  onProgress: (completedUnits: number) => boolean, wholeInvalid?: boolean) => void;
    setErrors:   (count: number) => void;
    setYarnColors: (a: string, b: string) => void;
    alternate:   () => boolean;
    setBusy:     (busy: boolean) => void;
    onAlternate: (cb: () => void) => void;
    onLivePreview: (cb: (completedUnits: number | null) => void) => void;
    onClose:     (cb: () => void) => void;
    close:       (restoreFocus?: boolean) => void;
}

export type InspectorPanel = "selection" | "settings" | "transforms" | "pattern";

export interface InspectorControls {
    isOpen: (panel: InspectorPanel) => boolean;
    open: (panel: InspectorPanel, title: string, trigger?: HTMLElement) => void;
    close: (restoreFocus?: boolean) => void;
    focusFirst: (panel: InspectorPanel) => void;
}
