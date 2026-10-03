import { el } from "./dom";
import type { CanvasWorkspace } from "./render";
import type { UICallbacks, UIHandle, InspectorPanel, InspectorControls } from "./ui-types";
import { mountToolbar } from "./ui-toolbar";
import { mountSelection } from "./ui-selection";
import { mountMirrors } from "./ui-mirrors";
import { mountPattern } from "./ui-pattern";
import { mountSettings } from "./ui-settings";
import { mountInstructions } from "./ui-instructions";

export type { UICallbacks, UIHandle, SelectionMoveMode, SelectionMode, InstructionOverviewUnit, InstructionsView } from "./ui-types";

export function mountUI(cb: UICallbacks): UIHandle {
    const inspectorHost = el("inspector-host");
    const inspectorTitle = el("inspector-title");
    const inspectorPanels: Record<InspectorPanel, HTMLElement> = {
        selection: el("selection-popover"),
        move: el("move-popover"),
        settings: el("hl-popover"),
        transforms: el("sym-popover"),
        pattern: el("edit-pattern-widget"),
    };
    const inspectorTriggers: Record<InspectorPanel, HTMLElement> = {
        selection: el("tool-select"),
        move: el("tool-move"),
        settings: el("btn-hl-toggle"),
        transforms: el("btn-sym-toggle"),
        pattern: el("btn-edit"),
    };
    let activeInspector: InspectorPanel | null = null;
    let activeInspectorTrigger: HTMLElement | null = null;
    let finishPatternEdit = () => {};
    const enterDesignForCommand = () => instructions.close(false);

    const workspaceShell = document.querySelector<HTMLElement>(".workspace")!;
    const canvasShell = document.querySelector<HTMLElement>(".canvas-area")!;
    const canvas = el("canvas");
    const canvasControls = document.querySelector<HTMLElement>(".canvas-controls")!;
    const canvasStatus = el("status");
    const canvasInstruction = el("instructions-current");
    const authoringPanel = el("authoring-dock");
    const crochetPanel = el("instructions-workspace");
    let canvasWorkspace: CanvasWorkspace = {
        left: 0, top: 0, right: canvas.clientWidth, bottom: canvas.clientHeight,
    };
    const syncCanvasChromeInsets = () => {
        const workspaceRect = workspaceShell.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const wide = matchMedia("(min-width: 64rem)").matches;
        const authoringRect = authoringPanel.hidden ? null : authoringPanel.getBoundingClientRect();
        const crochetRect = crochetPanel.hidden ? null : crochetPanel.getBoundingClientRect();
        const inspectorRect = inspectorHost.hidden ? null : inspectorHost.getBoundingClientRect();
        const modeRect = crochetRect ?? authoringRect;
        const left = wide && modeRect ? modeRect.right - workspaceRect.left : 0;
        const right = wide && inspectorRect ? workspaceRect.right - inspectorRect.left : 0;
        const bottom = wide ? 0 : Math.max(
            modeRect ? workspaceRect.bottom - modeRect.top : 0,
            inspectorRect ? workspaceRect.bottom - inspectorRect.top : 0,
        );
        canvasShell.style.setProperty("--canvas-chrome-left", `${Math.max(0, left)}px`);
        canvasShell.style.setProperty("--canvas-chrome-right", `${Math.max(0, right)}px`);
        canvasShell.style.setProperty("--canvas-chrome-bottom", `${Math.max(0, bottom)}px`);
        const workspace: CanvasWorkspace = {
            left: 0,
            top: 0,
            right: canvasRect.width,
            bottom: Math.max(0, canvasRect.height - bottom),
        };
        for (const chrome of [canvasControls, canvasStatus, canvasInstruction]) {
            if (chrome.getClientRects().length === 0) continue;
            const chromeRect = chrome.getBoundingClientRect();
            const chromeLeft = chromeRect.left - canvasRect.left;
            const chromeRight = chromeRect.right - canvasRect.left;
            if (chromeRight <= workspace.left || chromeLeft >= workspace.right) continue;
            const chromeTop = chromeRect.top - canvasRect.top;
            const chromeBottom = chromeRect.bottom - canvasRect.top;
            if (chromeTop + chromeBottom <= canvasRect.height) {
                workspace.top = Math.max(workspace.top, chromeBottom);
            } else {
                workspace.bottom = Math.min(workspace.bottom, chromeTop);
            }
        }
        canvasWorkspace = workspace;
    };
    const queueCanvasChromeSync = () => requestAnimationFrame(syncCanvasChromeInsets);
    const canvasChromeObserver = new ResizeObserver(queueCanvasChromeSync);
    for (const panel of [workspaceShell, authoringPanel, crochetPanel, inspectorHost]) {
        canvasChromeObserver.observe(panel);
    }
    window.addEventListener("resize", queueCanvasChromeSync);
    syncCanvasChromeInsets();

    function isInspectorOpen(panel: InspectorPanel) {
        return !inspectorHost.hidden && activeInspector === panel;
    }

    const panelTriggers: Record<InspectorPanel, HTMLElement[]> = {
        selection: [el("tool-select"), el("tool-wand")],
        move: [el("tool-move")],
        settings: [el("btn-hl-toggle")],
        transforms: [el("btn-sym-toggle")],
        pattern: [el("btn-edit")],
    };

    function openInspector(panel: InspectorPanel, title: string, trigger = inspectorTriggers[panel]) {
        if (activeInspector === "pattern" && panel !== "pattern") finishPatternEdit();
        if (activeInspector === "transforms" && panel !== "transforms") {
            cb.onTransformPopoverToggle(false);
        }
        activeInspector = panel;
        activeInspectorTrigger = trigger;
        inspectorHost.hidden = false;
        inspectorTitle.textContent = title;
        (Object.keys(inspectorPanels) as InspectorPanel[]).forEach(key => {
            inspectorPanels[key].hidden = key !== panel;
            panelTriggers[key].forEach(candidate => candidate.setAttribute(
                "aria-expanded",
                String(key === panel && (candidate === inspectorTriggers[key] || candidate === trigger)),
            ));
        });
        if (panel === "transforms") cb.onTransformPopoverToggle(true);
        syncCanvasChromeInsets();
        queueCanvasChromeSync();
    }

    function focusFirstInspectorControl(panel: InspectorPanel) {
        const controls = inspectorPanels[panel].querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        );
        Array.from(controls).find(control => control.getClientRects().length > 0)?.focus();
    }

    function closeInspector(restoreFocus = true) {
        const panel = activeInspector;
        if (activeInspector === "pattern") finishPatternEdit();
        if (activeInspector === "transforms") cb.onTransformPopoverToggle(false);
        inspectorHost.hidden = true;
        (Object.keys(inspectorPanels) as InspectorPanel[]).forEach(key => {
            inspectorPanels[key].hidden = true;
            panelTriggers[key].forEach(candidate => candidate.setAttribute("aria-expanded", "false"));
        });
        activeInspector = null;
        const trigger = activeInspectorTrigger;
        activeInspectorTrigger = null;
        syncCanvasChromeInsets();
        queueCanvasChromeSync();

        if (!restoreFocus) return;
        const more = el<HTMLButtonElement>("btn-more");
        const activeTool = document.querySelector<HTMLButtonElement>(
            ".authoring-dock .btn[aria-pressed='true']",
        );
        const triggerAvailable = trigger && trigger.getClientRects().length > 0
            && (!(trigger instanceof HTMLButtonElement) || !trigger.disabled);
        const target = triggerAvailable
            ? trigger
            : more.getClientRects().length > 0 ? more : activeTool;
        target?.focus();
    }

    const inspectorClose = el("inspector-close");
    inspectorClose.addEventListener("pointerdown", event => {
        event.preventDefault();
        closeInspector();
    });
    inspectorClose.addEventListener("click", () => {
        if (activeInspector !== null) closeInspector();
    });
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || activeInspector === null) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeInspector();
    }, true);

    const inspector: InspectorControls = {
        isOpen: isInspectorOpen, open: openInspector, close: closeInspector, focusFirst: focusFirstInspectorControl,
    };
    const toolbar = mountToolbar(cb, inspector, syncCanvasChromeInsets, enterDesignForCommand);
    const selection = mountSelection(cb, inspector, syncCanvasChromeInsets);
    const pattern = mountPattern(cb, inspector, enterDesignForCommand);
    finishPatternEdit = pattern.finishPatternEdit;
    const mirrors = mountMirrors(cb, inspector);
    mountSettings(cb, inspector, pattern.drawPatternPreview);
    const instructions = mountInstructions(cb, canvas, () => {
        const retainedInspector = activeInspector === "pattern" || activeInspector === "settings";
        if (activeInspector !== null && !retainedInspector) closeInspector(false);
    }, syncCanvasChromeInsets, queueCanvasChromeSync);

    return {
        ...toolbar, ...selection, ...mirrors,
        setPrimary: pattern.setPrimary, setColors: pattern.setColors, setProjectColors: pattern.setProjectColors,
        setEditError: pattern.setEditError, setEditSummary: pattern.setEditSummary, syncEditInputs: pattern.syncEditInputs,
        openInstructions: instructions.openInstructions,
        setCrochetProgress: instructions.setCrochetProgress, setCrochetErrors: instructions.setCrochetErrors,
        getCanvasWorkspace: () => {
            syncCanvasChromeInsets();
            return canvasWorkspace;
        },
    };
}
