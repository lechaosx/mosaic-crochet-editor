import type { Tool, ToolVariants } from "@mosaic/logic/types";
import type { ToolAction } from "@mosaic/logic/tool-input";
import { el, setPressed } from "./dom";
import type { UICallbacks, InspectorControls } from "./ui-types";
import { mountToolGroup } from "./tool-group";

export function mountToolbar(
    cb: Pick<UICallbacks, "onTool" | "onToolVariant" | "onUndo" | "onRedo" | "onRotate"
        | "onResetRotation" | "onFit" | "onZoom" | "onNavigate" | "onSave" | "onLoad">,
    inspector: Pick<InspectorControls, "open">,
    syncCanvasChromeInsets: () => void) {
    /* ── Tool buttons ─────────────────────────────────────────────────── */
    const toolButtons: Record<Tool, HTMLButtonElement> = {
        pencil:  el("tool-pencil"),
        fill:    el("tool-fill"),
        eraser:  el("tool-eraser"),
        overlay: el("tool-overlay"),
        invert:  el("tool-invert"),
        select:  el("tool-select"),
        wand:    el("tool-wand"),
        move:    el("tool-move"),
    };
    (Object.keys(toolButtons) as Tool[]).forEach(t => {
        if (t === "pencil" || t === "fill" || t === "eraser" || t === "invert")
            toolButtons[t].addEventListener("click", () => cb.onTool(t));
    });
    const selectionVariants = [
        { value: "replace", label: "Replace", icon: "select" },
        { value: "add", label: "Add", icon: "select-add" },
        { value: "remove", label: "Subtract", icon: "select-remove" },
    ] as const;
    const groups = {
        select: mountToolGroup(toolButtons.select, "Rectangle", selectionVariants, value => cb.onToolVariant("select", value)),
        wand: mountToolGroup(toolButtons.wand, "Wand", [
            { value: "replace", label: "Replace", icon: "wand" },
            { value: "add", label: "Add", icon: "wand-add" },
            { value: "remove", label: "Subtract", icon: "wand-remove" },
        ] as const, value => cb.onToolVariant("wand", value)),
        move: mountToolGroup(toolButtons.move, "Move", [
            { value: "move", label: "Move content", icon: "move" },
            { value: "duplicate", label: "Duplicate", icon: "copy" },
            { value: "mask-only", label: "Move area", icon: "move-area" },
        ] as const, value => cb.onToolVariant("move", value)),
        overlay: mountToolGroup(toolButtons.overlay, "Overlay", [
            { value: "place", label: "Place", icon: "overlay-place" },
            { value: "clear", label: "Clear", icon: "overlay-clear" },
            { value: "invert", label: "Invert", icon: "overlay-invert" },
        ] as const, value => cb.onToolVariant("overlay", value)),
    };

    function setToolVariants(variants: ToolVariants) {
        groups.select.setVariant(variants.select);
        groups.wand.setVariant(variants.wand);
        groups.move.setVariant(variants.move);
        groups.overlay.setVariant(variants.overlay);
    }

    let chosenTool: Tool = "pencil";
    let projectedAction: ToolAction | null = null;
    let projectedYarn: 1 | 2 | null = null;
    function projectTool() {
        const action = projectedAction;
        const tool = action === null ? chosenTool : action.kind === "paint" ? action.tool : action.kind;
        (Object.keys(toolButtons) as Tool[]).forEach(k => {
            if (toolButtons[k].getAttribute("aria-pressed") !== String(k === tool)) setPressed(toolButtons[k], k === tool);
        });
        groups.select.setDisplayedVariant(action?.kind === "select" ? action.mode : null);
        groups.wand.setDisplayedVariant(action?.kind === "wand" ? action.mode : null);
        groups.move.setDisplayedVariant(action?.kind === "move" ? action.mode : null);
        groups.overlay.setDisplayedVariant(action?.kind === "paint" && action.tool === "overlay" ? action.overlayAction : null);
    }
    function setTool(t: Tool) {
        chosenTool = t;
        projectTool();
        if (t === "select" || t === "wand") inspector.open("selection", "Selection", toolButtons[t]);
    }

    function setExecutingAction(action: ToolAction | null, yarn: 1 | 2 | null = null) {
        if (action === projectedAction && yarn === projectedYarn) return;
        projectedAction = action;
        projectedYarn = yarn;
        const label = action === null ? null
            : action.kind === "move" ? action.mode === "mask-only" ? "Move area" : action.mode === "duplicate" ? "Duplicate" : "Move content"
                : action.kind === "select" || action.kind === "wand"
                    ? `${action.kind === "select" ? "Rectangle" : "Wand"} · ${action.mode === "remove" ? "Subtract" : action.mode === "add" ? "Add" : "Replace"}`
                    : action.tool === "overlay" ? `Overlay · ${action.overlayAction === "place" ? "Place" : action.overlayAction === "clear" ? "Clear" : "Invert"}`
                        : action.tool === "fill" ? "Spill" : action.tool === "pencil" ? "Pencil" : action.tool === "eraser" ? "Eraser" : "Invert";
        const slot = yarn ?? (action?.kind === "paint" && (action.tool === "pencil" || action.tool === "fill") ? action.color : null);
        const feedback = el("status-action");
        feedback.textContent = label === null ? "" : `${label}${slot ? ` · Yarn ${slot === 1 ? "A" : "B"}` : ""}`;
        feedback.hidden = action === null;
        projectTool();
    }

    function setCanvasFeedback(message: string | null) {
        const feedback = el("status-feedback");
        const visibilityChanged = feedback.hidden === (message !== null);
        feedback.textContent = message ?? "";
        feedback.hidden = message === null;
        if (visibilityChanged) syncCanvasChromeInsets();
    }

    /* ── History and canvas view ─────────────────────────────────────── */
    el("btn-undo").addEventListener("click", cb.onUndo);
    el("btn-redo").addEventListener("click", cb.onRedo);
    el("rotate-cw") .addEventListener("click", () => cb.onRotate( 45));
    el("rotate-ccw").addEventListener("click", () => cb.onRotate(-45));
    el("view-rotation-reset").addEventListener("click", cb.onResetRotation);
    el("view-fit").addEventListener("click", cb.onFit);
    el("view-zoom-in").addEventListener("click", () => cb.onZoom(1.15));
    el("view-zoom-out").addEventListener("click", () => cb.onZoom(1 / 1.15));
    el("view-navigate").addEventListener("click", cb.onNavigate);

    function setHistory(canU: boolean, canR: boolean) {
        el<HTMLButtonElement>("btn-undo").disabled = !canU;
        el<HTMLButtonElement>("btn-redo").disabled = !canR;
    }

    function setRecoveryStatus(state: "saved" | "recovered" | "failed") {
        const status = el("recovery-status");
        status.dataset.state = state;
        status.hidden = state === "saved";
        status.textContent = state === "failed"
            ? "Recovery failed"
            : state === "recovered" ? "Recovered" : "";
        status.title = state === "failed"
            ? "Browser recovery could not be updated; recent changes may be lost if this tab closes."
            : "Browser recovery is current. Save creates a separate editable pattern file.";
    }

    let documentErrorReturn: "load" | "save" = "load";
    function setDocumentError(message: string | null, returnTo: "load" | "save" = "load") {
        const error = el("document-error");
        error.setAttribute("role", "alert");
        error.classList.remove("document-notice");
        const dismiss = el("document-error-dismiss");
        dismiss.setAttribute("aria-label", "Dismiss document error");
        dismiss.title = "Dismiss document error";
        if (message !== null) documentErrorReturn = returnTo;
        el("document-error-message").textContent = message ?? "";
        error.hidden = message === null;
    }
    function setDocumentNotice(message: string) {
        setDocumentError(message);
        const notice = el("document-error");
        notice.setAttribute("role", "status");
        notice.classList.add("document-notice");
        const dismiss = el("document-error-dismiss");
        dismiss.setAttribute("aria-label", "Dismiss document notice");
        dismiss.title = "Dismiss document notice";
    }
    el("document-error-dismiss").addEventListener("click", () => {
        setDocumentError(null);
        const action = el<HTMLButtonElement>(documentErrorReturn === "save" ? "btn-save" : "btn-load");
        const more = el<HTMLButtonElement>("btn-more");
        (action.getClientRects().length > 0 ? action : more).focus();
    });

    function setViewState(rotation: number, navigating: boolean) {
        const navigate = el<HTMLButtonElement>("view-navigate");
        setPressed(navigate, navigating);
        el("canvas").classList.toggle("canvas--navigate", navigating);
        const normalized = ((Math.round(rotation) % 360) + 360) % 360;
        const signed = normalized > 180 ? normalized - 360 : normalized;
        const angle = `${signed < 0 ? "−" : ""}${Math.abs(signed)}°`;
        const reset = el<HTMLButtonElement>("view-rotation-reset");
        reset.disabled = signed === 0;
        reset.setAttribute("aria-label", signed === 0 ? "Reset view orientation" : `Reset view orientation from ${angle}`);
        reset.title = signed === 0 ? "Reset view orientation" : `Reset view orientation from ${angle}`;
        el<HTMLElement>("view-orientation-arrow").style.transform = `rotate(${rotation}deg)`;
    }

    /* ── Save / load / Instructions ─────────────────────────────────── */
    el("btn-save")  .addEventListener("click", cb.onSave);
    el("btn-load").addEventListener("click", cb.onLoad);

    mountToolbarLayout();

    return { setTool, setToolVariants, setExecutingAction, setCanvasFeedback, setHistory, setRecoveryStatus, setDocumentError, setDocumentNotice, setViewState };
}
// ─── Toolbar layout ──────────────────────────────────────────────────────────
function mountToolbarLayout() {
    const documentBar = el("document-bar");
    const modeGroup = document.querySelector(".g-mode") as HTMLElement;
    const fileGroup = document.querySelector(".g-file") as HTMLElement;
    const viewGroup = document.querySelector(".g-hlrot") as HTMLElement;
    const moreButton = el<HTMLButtonElement>("btn-more");
    const morePopover = el("more-popover");
    const moreActions = el("more-actions");
    const fileActions = [el("btn-edit"), el("btn-load"), el("btn-save")];
    const viewActions = [el("btn-hl-toggle")];
    const compactActions = [...fileActions, ...viewActions] as HTMLButtonElement[];
    let compact = false;
    let compactBelow = 0;

    moreButton.addEventListener("click", e => {
        e.preventDefault();
        if (morePopover.matches(":popover-open")) morePopover.hidePopover();
        else {
            positionPopover(morePopover, moreButton, "left");
            morePopover.showPopover();
            compactActions.find(button => !button.disabled)?.focus();
        }
    });
    morePopover.addEventListener("toggle", e => {
        moreButton.setAttribute("aria-expanded", String((e as ToggleEvent).newState === "open"));
    });
    moreActions.addEventListener("click", e => {
        if ((e.target as Element).closest("button") && morePopover.matches(":popover-open"))
            morePopover.hidePopover();
    });
    morePopover.addEventListener("keydown", e => {
        if (e.key === "Tab") {
            morePopover.hidePopover();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const enabled = compactActions.filter(button => !button.disabled);
        const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
        const target = e.key === "Home" ? enabled[0]
            : e.key === "End" ? enabled.at(-1)!
            : enabled[(current + (e.key === "ArrowUp" ? -1 : 1) + enabled.length) % enabled.length];
        target.focus();
    });

    function setCompact(next: boolean) {
        if (compact === next) return;
        compact = next;
        if (compact) {
            for (const button of compactActions) {
                button.setAttribute("role", "menuitem");
                button.tabIndex = -1;
            }
            moreActions.append(...fileActions, ...viewActions);
            moreButton.hidden = false;
        } else {
            fileGroup.prepend(...fileActions);
            viewGroup.append(...viewActions);
            for (const button of compactActions) {
                button.removeAttribute("role");
                button.tabIndex = 0;
            }
            moreButton.hidden = true;
            if (morePopover.matches(":popover-open")) morePopover.hidePopover();
        }
    }

    function measure() {
        setCompact(false);
        documentBar.classList.remove("document-bar--compact");
        const cs = getComputedStyle(documentBar);
        const padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const gap     = parseFloat(cs.columnGap) || 0;
        compactBelow = padding + gap * 2 + modeGroup.offsetWidth
            + 2 * Math.max(fileGroup.offsetWidth, viewGroup.offsetWidth);
    }

    function applyLayout() {
        const useCompact = window.innerWidth < compactBelow;
        setCompact(useCompact);
        documentBar.classList.toggle("document-bar--compact", useCompact);
    }

    function update() {
        const focused = compactActions.find(button => button === document.activeElement);
        const menuOpen = morePopover.matches(":popover-open");
        measure();
        applyLayout();
        if (menuOpen && compact) {
            positionPopover(morePopover, moreButton, "left");
            morePopover.showPopover();
        }
        if (focused) (focused.getClientRects().length > 0 ? focused : moreButton).focus();
    }

    update();
    window.addEventListener("resize", applyLayout);
    const layoutObserver = new ResizeObserver(update);
    layoutObserver.observe(documentBar);
    layoutObserver.observe(modeGroup);

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(update);
    }
}

// Position a popover under its anchor button using fixed coords.
// (anchor-positioning CSS is still rolling out; this works everywhere.)
function positionPopover(pop: HTMLElement, anchor: HTMLElement, align: "left" | "right") {
    const r = anchor.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top      = `${r.bottom + 4}px`;
    if (align === "left") {
        pop.style.left  = `${r.left}px`;
        pop.style.right = "auto";
    } else {
        pop.style.right = `${window.innerWidth - r.right}px`;
        pop.style.left  = "auto";
    }
}
