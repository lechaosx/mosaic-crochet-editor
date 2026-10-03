import type { Tool } from "@mosaic/logic/types";
import type { OverlayAction } from "@mosaic/logic/paint";
import { el, setPressed } from "./dom";
import type { UICallbacks, InspectorControls } from "./ui-types";

export function mountToolbar(
    cb: Pick<UICallbacks, "onTool" | "onOverlayAction" | "onUndo" | "onRedo" | "onRotate"
        | "onResetRotation" | "onFit" | "onZoom" | "onNavigate" | "onSave" | "onLoad">,
    inspector: Pick<InspectorControls, "open">,
    syncCanvasChromeInsets: () => void, enterDesignForCommand: () => void) {
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
        if (t !== "overlay") toolButtons[t].addEventListener("click", () => cb.onTool(t));
    });
    const overlayButtons: Record<OverlayAction, HTMLButtonElement> = {
        place: toolButtons.overlay,
        clear: el("overlay-clear"),
        invert: el("overlay-invert"),
    };
    let overlayAction: OverlayAction = "place";
    let currentTool: Tool = "pencil";
    (Object.keys(overlayButtons) as OverlayAction[]).forEach(action =>
        overlayButtons[action].addEventListener("click", () => cb.onOverlayAction(action))
    );

    function setTool(t: Tool) {
        currentTool = t;
        (Object.keys(toolButtons) as Tool[]).forEach(k => {
            const active = k === t && (k !== "overlay" || overlayAction === "place");
            setPressed(toolButtons[k], active);
        });
        for (const action of ["clear", "invert"] as const) {
            const active = t === "overlay" && overlayAction === action;
            setPressed(overlayButtons[action], active);
        }
        if (t === "select" || t === "wand") inspector.open("selection", "Selection", toolButtons[t]);
        else if (t === "move") inspector.open("move", "Move", toolButtons.move);
    }
    function setOverlayAction(action: OverlayAction) {
        overlayAction = action;
        setTool("overlay");
    }

    function setCanvasFeedback(message: string | null) {
        const feedback = el("status-feedback");
        const visibilityChanged = feedback.hidden === (message !== null);
        feedback.textContent = message ?? "";
        feedback.hidden = message === null;
        if (visibilityChanged) syncCanvasChromeInsets();
    }

    /* ── History and canvas view ─────────────────────────────────────── */
    el("btn-undo").addEventListener("click", () => {
        enterDesignForCommand();
        cb.onUndo();
    });
    el("btn-redo").addEventListener("click", () => {
        enterDesignForCommand();
        cb.onRedo();
    });
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
        if (message !== null) documentErrorReturn = returnTo;
        el("document-error-message").textContent = message ?? "";
        error.hidden = message === null;
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
    el("btn-load").addEventListener("click", () => {
        enterDesignForCommand();
        cb.onLoad();
    });

    mountToolbarLayout();

    return { setTool, setOverlayAction, setCanvasFeedback, setHistory, setRecoveryStatus, setDocumentError, setViewState };
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
        compactBelow = padding + gap * 2 + modeGroup.offsetWidth + fileGroup.offsetWidth + viewGroup.offsetWidth;
    }

    function applyLayout() {
        const useCompact = window.innerWidth < compactBelow;
        setCompact(useCompact);
        documentBar.classList.toggle("document-bar--compact", useCompact);
    }

    function update() { measure(); applyLayout(); }

    update();
    window.addEventListener("resize", applyLayout);

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
