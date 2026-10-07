import type { PatternState } from "@mosaic/logic/types";
import { el, setRadio, clampInputDisplay, setPressed, setMessage } from "./dom";
import { renderPatternColourPreview } from "./render";
import type { UICallbacks, InspectorControls } from "./ui-types";

function bindLongPress(target: HTMLElement, onClick: () => void, onLong: () => void) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0, startY = 0;

    const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

    target.addEventListener("pointerdown", event => {
        startX = event.clientX;
        startY = event.clientY;
        cancel();
        timer = setTimeout(() => { timer = null; onLong(); }, 500);
    });
    target.addEventListener("pointermove", event => {
        if (timer !== null && Math.hypot(event.clientX - startX, event.clientY - startY) > 8) cancel();
    });
    target.addEventListener("pointerup", () => {
        if (timer !== null) { cancel(); onClick(); }
    });
    target.addEventListener("pointercancel", cancel);
    target.addEventListener("pointerleave", cancel);
}

export function mountPattern(
    cb: Pick<UICallbacks, "onPrimaryColor" | "onSwapYarns" | "onResetYarnColor" | "onColorChange" | "onColorCommit"
        | "onEditOpen" | "onEditChange" | "onEditCommit" | "onEditRevert" | "onDangerColorChange"
        | "onAccentColorChange" | "onDangerColorReset" | "onAccentColorReset">,
    inspector: Pick<InspectorControls, "isOpen" | "open" | "close" | "focusFirst">, enterDesignForCommand: () => void) {
    /* ── Colour swatches ──────────────────────────────────────────────── */
    const swatchA = el("swatch-a");
    const swatchB = el("swatch-b");
    const colorA  = el<HTMLInputElement>("color-a");
    const colorB  = el<HTMLInputElement>("color-b");
    const patternColourPreview = el("pattern-colour-preview");
    const patternPreviewCanvas = el<HTMLCanvasElement>("pattern-preview-canvas");
    const previewReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let previewFrame: number | null = null;
    let previewLastTime = 0;
    let previewAntsElapsedMs = 0;
    function drawPatternPreview() {
        const visible = patternPreviewCanvas.clientWidth > 0 && !document.hidden;
        if ((!visible || previewReducedMotion.matches) && previewFrame !== null) {
            cancelAnimationFrame(previewFrame);
            previewFrame = null;
        }
        if (!visible) return;
        renderPatternColourPreview(
            patternPreviewCanvas, patternColourPreview.dataset.mode === "round" ? "round" : "row",
            patternColourPreview.dataset.extent as "full" | "half" | "quarter",
            colorA.value, colorB.value, el<HTMLInputElement>("danger-color").value,
            el<HTMLInputElement>("accent-color").value,
            Number(el<HTMLInputElement>("hl-opacity").value) / 100, previewAntsElapsedMs,
        );
        if (!previewReducedMotion.matches && previewFrame === null) {
            previewLastTime = performance.now();
            previewFrame = requestAnimationFrame(now => {
                previewFrame = null;
                previewAntsElapsedMs = (previewAntsElapsedMs + Math.min(50, now - previewLastTime)) % 100000;
                drawPatternPreview();
            });
        }
    }
    new ResizeObserver(drawPatternPreview).observe(patternPreviewCanvas);
    previewReducedMotion.addEventListener("change", drawPatternPreview);
    document.addEventListener("visibilitychange", drawPatternPreview);

    const openYarnPicker = (slot: 1 | 2) => {
        if (!inspector.isOpen("pattern")) {
            inspector.open("pattern", "Pattern");
            cb.onEditOpen();
        }
        const picker = slot === 1 ? colorA : colorB;
        picker.focus();
        picker.click();
    };
    bindLongPress(swatchA, () => cb.onPrimaryColor(1), () => openYarnPicker(1));
    bindLongPress(swatchB, () => cb.onPrimaryColor(2), () => openYarnPicker(2));
    const selectWithKeyboard = (event: KeyboardEvent, slot: 1 | 2) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        cb.onPrimaryColor(slot);
    };
    swatchA.addEventListener("keydown", event => selectWithKeyboard(event, 1));
    swatchB.addEventListener("keydown", event => selectWithKeyboard(event, 2));
    swatchA.addEventListener("dblclick", () => openYarnPicker(1));
    swatchB.addEventListener("dblclick", () => openYarnPicker(2));
    el("swap-yarns").addEventListener("click", cb.onSwapYarns);
    el("color-a-reset").addEventListener("click", () => cb.onResetYarnColor(1));
    el("color-b-reset").addEventListener("click", () => cb.onResetYarnColor(2));
    colorA.addEventListener("input",  cb.onColorChange);
    colorB.addEventListener("input",  cb.onColorChange);
    // `change` fires when the picker closes — that's the user's "I'm done"
    // signal and the right moment to push a history snapshot.
    colorA.addEventListener("change", cb.onColorCommit);
    colorB.addEventListener("change", cb.onColorCommit);

    let chosenPrimary: 1 | 2 = 1;
    let executingYarn: 1 | 2 | null = null;
    function projectPrimary() {
        const slot = executingYarn ?? chosenPrimary;
        setPressed(swatchA, slot === 1, "swatch--active");
        setPressed(swatchB, slot === 2, "swatch--active");
    }
    function setPrimary(slot: 1 | 2) {
        chosenPrimary = slot;
        projectPrimary();
    }
    function setExecutingYarn(slot: 1 | 2 | null) {
        executingYarn = slot;
        projectPrimary();
    }
    function setColors(a: string, b: string) {
        colorA.value = a; colorB.value = b;
        el<HTMLButtonElement>("color-a-reset").disabled = a.toLowerCase() === "#000000";
        el<HTMLButtonElement>("color-b-reset").disabled = b.toLowerCase() === "#ffffff";
        swatchA.style.background = a;
        swatchB.style.background = b;
        drawPatternPreview();
    }
    function setProjectColors(danger: string, accent: string, automaticDanger: boolean, automaticAccent: boolean) {
        el<HTMLInputElement>("danger-color").value = danger;
        el<HTMLInputElement>("accent-color").value = accent;
        for (const [kind, automatic] of [["danger", automaticDanger], ["accent", automaticAccent]] as const) {
            el<HTMLButtonElement>(`${kind}-color-reset`).disabled = automatic;
            el(`${kind}-color-mode`).textContent = automatic ? "Automatic" : "Custom";
        }
        drawPatternPreview();
    }

    /* ── Pattern inspector ────────────────────────────────────────────── */
    const editWidget = el("edit-pattern-widget");
    const btnEdit    = el<HTMLButtonElement>("btn-edit");
    const editError  = el("edit-error");
    const editSummary = el("edit-summary");
    let editValid = true;
    let editPreviewActive = false;
    let skipPatternChange = false;

    function setEditError(message: string | null) {
        setMessage(editError, message);
        editValid = message === null;
    }

    function setEditSummary(width: number, height: number, _preserved: number, added: number, removed: number) {
        const changes = [
            added > 0 ? `${added} cell${added === 1 ? "" : "s"} added` : null,
            removed > 0 ? `${removed} cell${removed === 1 ? "" : "s"} removed` : null,
        ].filter((change): change is string => change !== null);
        editSummary.textContent = changes.length > 0
            ? `${width} × ${height} cells · ${changes.join(" · ")}`
            : "";
        editSummary.hidden = changes.length === 0;
    }

    const finishPatternEdit = () => {
        if (!editPreviewActive) return;
        skipPatternChange = true;
        queueMicrotask(() => { skipPatternChange = false; });
        if (editValid) cb.onEditCommit();
        else cb.onEditRevert();
        editPreviewActive = false;
    };
    btnEdit.addEventListener("click", e => {
        e.preventDefault();
        if (inspector.isOpen("pattern")) {
            inspector.close();
            return;
        }
        inspector.open("pattern", "Pattern");
        cb.onEditOpen();
        inspector.focusFirst("pattern");
    });

    document.addEventListener("pointerdown", e => {
        if (!inspector.isOpen("pattern") || editWidget.contains(e.target as Node)) return;
        if ((e.target as Element).closest?.("#inspector-close")) return;
        finishPatternEdit();
    }, true);

    function refreshWipeAvailability() {
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        wipeEl.disabled = false;
    }

    function applyAndCommitPatternEdit(clearDesign = false) {
        editPreviewActive = true;
        if (cb.onEditChange(clearDesign)) {
            cb.onEditCommit(clearDesign);
            enterDesignForCommand();
        } else cb.onEditRevert();
        editPreviewActive = false;
    }

    document.querySelectorAll<HTMLInputElement>('[name="edit-mode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            const mode = radio.value;
            el("edit-row-controls")  .hidden = mode !== "row";
            el("edit-round-controls").hidden = mode !== "round";
            refreshWipeAvailability();
            if (inspector.isOpen("pattern")) applyAndCommitPatternEdit();
        });
    });
    document.querySelectorAll<HTMLInputElement>('[name="edit-submode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            if (inspector.isOpen("pattern")) applyAndCommitPatternEdit();
        });
    });
    const EDIT_INPUTS: { id: string; min: number }[] = [
        { id: "edit-width",        min: 2 },
        { id: "edit-height",       min: 2 },
        { id: "edit-inner-width",  min: 0 },
        { id: "edit-inner-height", min: 0 },
        { id: "edit-rounds",       min: 1 },
    ];
    EDIT_INPUTS.forEach(({ id, min }) => {
        const preview = () => {
            refreshWipeAvailability();
            if (inspector.isOpen("pattern")) {
                editPreviewActive = true;
                if (cb.onEditChange()) enterDesignForCommand();
            }
        };
        el(id).addEventListener("input", preview);
        el(id).addEventListener("change", () => {
            if (skipPatternChange) {
                skipPatternChange = false;
                return;
            }
            clampInputDisplay(id, min);
            refreshWipeAvailability();
            if (inspector.isOpen("pattern")) applyAndCommitPatternEdit();
        });
    });
    el("edit-reset").addEventListener("click", () => {
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        wipeEl.checked = true;
        if (inspector.isOpen("pattern")) applyAndCommitPatternEdit(true);
        wipeEl.checked = false;
        refreshWipeAvailability();
    });

    function syncEditInputs(s: PatternState) {
        patternColourPreview.dataset.mode = s.mode;
        patternColourPreview.setAttribute(
            "aria-label",
            `${s.mode === "row" ? "Rows" : "Centre-out"} colour preview with selection, grid, mirror, valid overlay, and invalid overlay`,
        );
        setEditError(null);
        setRadio("edit-mode", s.mode);
        el("edit-row-controls")  .hidden = s.mode !== "row";
        el("edit-round-controls").hidden = s.mode !== "round";
        if (s.mode === "row") {
            patternColourPreview.dataset.extent = "full";
            patternColourPreview.style.aspectRatio = "1";
            el<HTMLInputElement>("edit-width") .value = String(s.canvasWidth);
            el<HTMLInputElement>("edit-height").value = String(s.canvasHeight);
        } else {
            const innerW = s.virtualWidth  - s.rounds * 2;
            const innerH = s.virtualHeight - s.rounds * 2;
            const sub = s.offsetX === 0 && s.offsetY === 0
                ? "full"
                : s.canvasWidth === s.virtualWidth ? "half" : "quarter";
            setRadio("edit-submode", sub);
            patternColourPreview.dataset.extent = sub;
            patternColourPreview.style.aspectRatio = "1";
            el<HTMLInputElement>("edit-inner-width") .value = String(innerW);
            el<HTMLInputElement>("edit-inner-height").value = String(innerH);
            el<HTMLInputElement>("edit-rounds")      .value = String(s.rounds);
        }
        drawPatternPreview();
        // Every committed change starts the next field from preservation.
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        wipeEl.checked = false;
        refreshWipeAvailability();
        setEditSummary(s.canvasWidth, s.canvasHeight, s.canvasWidth * s.canvasHeight, 0, 0);
    }

    el<HTMLInputElement>("danger-color")      .addEventListener("input",  cb.onDangerColorChange);
    el<HTMLInputElement>("accent-color")      .addEventListener("input",  cb.onAccentColorChange);
    el<HTMLInputElement>("danger-color")      .addEventListener("change", cb.onColorCommit);
    el<HTMLInputElement>("accent-color")      .addEventListener("change", cb.onColorCommit);
    el("danger-color-reset").addEventListener("click", cb.onDangerColorReset);
    el("accent-color-reset").addEventListener("click", cb.onAccentColorReset);

    return { setPrimary, setExecutingYarn, setColors, setProjectColors, setEditError, setEditSummary, syncEditInputs, finishPatternEdit, drawPatternPreview };
}
