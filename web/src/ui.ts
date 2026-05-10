import { Tool, SymKey, PatternState } from "./types";
import { el, setRadio, clampInputDisplay } from "./dom";

// ─── Long-press / click helper (works for mouse, pen, touch) ──────────────────
function bindLongPress(target: HTMLElement, onClick: () => void, onLong: () => void) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0, startY = 0;

    const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

    target.addEventListener("pointerdown", e => {
        startX = e.clientX; startY = e.clientY;
        cancel();
        timer = setTimeout(() => { timer = null; onLong(); }, 500);
    });
    target.addEventListener("pointermove", e => {
        if (timer === null) return;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) cancel();
    });
    target.addEventListener("pointerup", () => {
        if (timer !== null) { cancel(); onClick(); }
    });
    target.addEventListener("pointercancel", cancel);
    target.addEventListener("pointerleave",  cancel);
}

// ─── Symmetry button ids ──────────────────────────────────────────────────────
const SYM_BUTTONS: { id: string; key: SymKey }[] = [
    { id: "sym-vertical",   key: "V"  },
    { id: "sym-horizontal", key: "H"  },
    { id: "sym-central",    key: "C"  },
    { id: "sym-diag1",      key: "D1" },
    { id: "sym-diag2",      key: "D2" },
];

// ─── Public surface ───────────────────────────────────────────────────────────
export interface UICallbacks {
    onTool:            (t: Tool) => void;
    onPrimaryColor:    (slot: 1 | 2) => void;
    onColorChange:     () => void;
    onSym:             (k: SymKey) => void;
    onHighlightChange: () => void;
    onUndo:            () => void;
    onRedo:            () => void;
    onRotate:          (delta: number) => void;
    onNewClick:        () => Promise<boolean>;
    onNewApply:        () => void;
    onSave:            () => void;
    onLoad:            () => void;
    onExport:          () => void;
}

export interface UIHandle {
    setTool:            (t: Tool) => void;
    setPrimary:         (slot: 1 | 2) => void;
    setColors:          (a: string, b: string) => void;
    setHighlights:      (overlay: string, invalid: string, opacity: number) => void;
    setSymmetry:        (direct: Set<SymKey>, closure: Set<SymKey>) => void;
    setDiagonalEnabled: (enabled: boolean) => void;
    setHistory:         (undo: boolean, redo: boolean) => void;
    syncNewInputs:      (s: PatternState) => void;
    closeNew:           () => void;
    confirmDirty:       () => Promise<boolean>;
    openExport:         () => ExportDialog;
}

export interface ExportDialog {
    setProgress: (count: number, total: number) => void;
    endProgress: () => void;
    appendLine:  (line: string) => void;
    clearText:   () => void;
    setWarning:  (visible: boolean) => void;
    alternate:   () => boolean;
    setBusy:     (busy: boolean) => void;
    onAlternate: (cb: () => void) => void;
    onClose:     (cb: () => void) => void;
    close:       () => void;
}

// ─── Mount ────────────────────────────────────────────────────────────────────
export function mountUI(cb: UICallbacks): UIHandle {
    /* ── Tool buttons ─────────────────────────────────────────────────── */
    const toolButtons: Record<Tool, HTMLButtonElement> = {
        pencil: el("tool-pencil"),
        fill:   el("tool-fill"),
        eraser: el("tool-eraser"),
        invert: el("tool-invert"),
    };
    (Object.keys(toolButtons) as Tool[]).forEach(t =>
        toolButtons[t].addEventListener("click", () => cb.onTool(t))
    );
    function setTool(t: Tool) {
        (Object.keys(toolButtons) as Tool[]).forEach(k =>
            toolButtons[k].classList.toggle("btn--active", k === t)
        );
    }

    /* ── Colour swatches ──────────────────────────────────────────────── */
    const swatchA = el("swatch-a");
    const swatchB = el("swatch-b");
    const colorA  = el<HTMLInputElement>("color-a");
    const colorB  = el<HTMLInputElement>("color-b");

    bindLongPress(swatchA, () => cb.onPrimaryColor(1), () => colorA.click());
    bindLongPress(swatchB, () => cb.onPrimaryColor(2), () => colorB.click());
    swatchA.addEventListener("dblclick", () => colorA.click());
    swatchB.addEventListener("dblclick", () => colorB.click());
    colorA.addEventListener("input", cb.onColorChange);
    colorB.addEventListener("input", cb.onColorChange);

    function setPrimary(slot: 1 | 2) {
        swatchA.classList.toggle("swatch--active", slot === 1);
        swatchB.classList.toggle("swatch--active", slot === 2);
    }
    function setColors(a: string, b: string) {
        colorA.value = a; colorB.value = b;
        swatchA.style.background = a;
        swatchB.style.background = b;
    }

    /* ── Symmetry ─────────────────────────────────────────────────────── */
    SYM_BUTTONS.forEach(({ id, key }) =>
        el(id).addEventListener("click", () => cb.onSym(key))
    );
    function setSymmetry(direct: Set<SymKey>, closure: Set<SymKey>) {
        SYM_BUTTONS.forEach(({ id, key }) => {
            const btn = el(id);
            btn.classList.toggle("btn--active",  direct.has(key));
            btn.classList.toggle("btn--implied", !direct.has(key) && closure.has(key));
        });
    }
    function setDiagonalEnabled(enabled: boolean) {
        (["sym-diag1", "sym-diag2"] as const).forEach(id =>
            el<HTMLButtonElement>(id).disabled = !enabled
        );
    }

    /* ── Highlight popover ────────────────────────────────────────────── */
    const hlPopover     = el("hl-popover");
    const hlOverlayCol  = el<HTMLInputElement>("hl-overlay-color");
    const hlInvalidCol  = el<HTMLInputElement>("hl-invalid-color");
    const hlOpacity     = el<HTMLInputElement>("hl-opacity");
    const swatchHlOver  = el("swatch-hl-overlay");
    const swatchHlInv   = el("swatch-hl-invalid");

    el("btn-hl-toggle").addEventListener("click", e => {
        // Intercept the popovertarget toggle so we can position before showing.
        e.preventDefault();
        if (hlPopover.matches(":popover-open")) { hlPopover.hidePopover(); return; }
        positionPopover(hlPopover, el("btn-hl-toggle"), "right");
        hlPopover.showPopover();
    });
    swatchHlOver.addEventListener("click", () => hlOverlayCol.click());
    swatchHlInv .addEventListener("click", () => hlInvalidCol.click());
    hlOverlayCol.addEventListener("input", cb.onHighlightChange);
    hlInvalidCol.addEventListener("input", cb.onHighlightChange);
    hlOpacity   .addEventListener("input", cb.onHighlightChange);

    function setHighlights(overlay: string, invalid: string, opacity: number) {
        hlOverlayCol.value = overlay;
        hlInvalidCol.value = invalid;
        hlOpacity.value    = String(opacity);
        swatchHlOver.style.background = overlay;
        swatchHlInv .style.background = invalid;
    }

    /* ── Undo / redo / rotate ────────────────────────────────────────── */
    el("btn-undo")  .addEventListener("click", cb.onUndo);
    el("btn-redo")  .addEventListener("click", cb.onRedo);
    el("rotate-cw") .addEventListener("click", () => cb.onRotate( 45));
    el("rotate-ccw").addEventListener("click", () => cb.onRotate(-45));

    function setHistory(canU: boolean, canR: boolean) {
        el<HTMLButtonElement>("btn-undo").disabled = !canU;
        el<HTMLButtonElement>("btn-redo").disabled = !canR;
    }

    /* ── Save / load / export ────────────────────────────────────────── */
    el("btn-save")  .addEventListener("click", cb.onSave);
    el("btn-load")  .addEventListener("click", cb.onLoad);
    el("btn-export").addEventListener("click", cb.onExport);

    /* ── New-pattern popover ─────────────────────────────────────────── */
    const npWidget = el("new-pattern-widget");
    const btnNew = el<HTMLButtonElement>("btn-new");

    btnNew.addEventListener("click", async e => {
        // Browser would auto-toggle via popovertarget; intercept so we can run
        // the dirty-confirm flow before opening.
        e.preventDefault();
        if (npWidget.matches(":popover-open")) { npWidget.hidePopover(); return; }
        if (!await cb.onNewClick()) return;
        positionPopover(npWidget, btnNew, "left");
        npWidget.showPopover();
        cb.onNewApply();
    });

    document.querySelectorAll<HTMLInputElement>('[name="np-mode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            const mode = radio.value;
            el("row-controls").hidden   = mode !== "row";
            el("round-controls").hidden = mode !== "round";
            if (npWidget.matches(":popover-open")) cb.onNewApply();
        });
    });
    document.querySelectorAll<HTMLInputElement>('[name="np-submode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            if (npWidget.matches(":popover-open")) cb.onNewApply();
        });
    });
    const NUM_INPUTS: { id: string; min: number }[] = [
        { id: "width",        min: 2 },
        { id: "height",       min: 2 },
        { id: "inner-width",  min: 0 },
        { id: "inner-height", min: 0 },
        { id: "rounds",       min: 1 },
    ];
    NUM_INPUTS.forEach(({ id, min }) => {
        const apply = () => { if (npWidget.matches(":popover-open")) cb.onNewApply(); };
        el(id).addEventListener("input", apply);
        el(id).addEventListener("change", () => {
            clampInputDisplay(id, min);
            apply();
        });
    });

    function syncNewInputs(s: PatternState) {
        setRadio("np-mode", s.mode);
        el("row-controls").hidden   = s.mode !== "row";
        el("round-controls").hidden = s.mode !== "round";
        if (s.mode === "row") {
            el<HTMLInputElement>("width").value  = String(s.canvasWidth);
            el<HTMLInputElement>("height").value = String(s.canvasHeight);
        } else {
            const innerW = s.virtualWidth  - s.rounds * 2;
            const innerH = s.virtualHeight - s.rounds * 2;
            const sub = s.offsetX === 0 && s.offsetY === 0
                ? "full"
                : s.canvasWidth === s.virtualWidth ? "half" : "quarter";
            setRadio("np-submode", sub);
            el<HTMLInputElement>("inner-width") .value = String(innerW);
            el<HTMLInputElement>("inner-height").value = String(innerH);
            el<HTMLInputElement>("rounds")      .value = String(s.rounds);
        }
    }

    /* ── Dialogs ─────────────────────────────────────────────────────── */
    const dirtyDlg = el<HTMLDialogElement>("dirty-dialog");
    el("dirty-cancel") .addEventListener("click", () => dirtyDlg.close("cancel"));
    el("dirty-discard").addEventListener("click", () => dirtyDlg.close("discard"));
    bindBackdropClose(dirtyDlg);

    function confirmDirty(): Promise<boolean> {
        return new Promise(resolve => {
            const handler = () => {
                dirtyDlg.removeEventListener("close", handler);
                resolve(dirtyDlg.returnValue === "discard");
            };
            dirtyDlg.addEventListener("close", handler);
            dirtyDlg.returnValue = "cancel";
            dirtyDlg.showModal();
        });
    }

    /* ── Export dialog ───────────────────────────────────────────────── */
    const exportDlg      = el<HTMLDialogElement>("export-dialog");
    const exportText     = el<HTMLTextAreaElement>("export-text");
    const exportProgress = el("export-progress");
    const exportWarning  = el("export-warning");
    const alternateChk   = el<HTMLInputElement>("alternate");
    bindBackdropClose(exportDlg);
    el("export-close").addEventListener("click", () => exportDlg.close());
    el("export-copy").addEventListener("click", () =>
        navigator.clipboard.writeText(exportText.value)
    );
    el("export-download").addEventListener("click", () => {
        const blob = new Blob([exportText.value], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement("a"), { href: url, download: "pattern.txt" }).click();
        URL.revokeObjectURL(url);
    });

    function openExport(): ExportDialog {
        exportDlg.showModal();
        const altListeners: (() => void)[] = [];
        const closeListeners: (() => void)[] = [];
        const onAlt = () => altListeners.forEach(f => f());
        alternateChk.addEventListener("change", onAlt);

        const onClose = () => {
            exportDlg.removeEventListener("close", onClose);
            alternateChk.removeEventListener("change", onAlt);
            closeListeners.forEach(f => f());
        };
        exportDlg.addEventListener("close", onClose);

        return {
            setProgress: (count, total) => {
                exportProgress.hidden = false;
                exportProgress.textContent = `Generating… ${count} / ${total}`;
            },
            endProgress: () => { exportProgress.hidden = true; },
            appendLine: (line) => {
                exportText.value += (exportText.value ? "\n" : "") + line;
            },
            clearText: () => { exportText.value = ""; },
            setWarning: (v) => { exportWarning.hidden = !v; },
            alternate: () => alternateChk.checked,
            setBusy: (busy) => {
                el<HTMLButtonElement>("export-copy")    .disabled = busy;
                el<HTMLButtonElement>("export-download").disabled = busy;
            },
            onAlternate: (f) => altListeners.push(f),
            onClose:     (f) => closeListeners.push(f),
            close:       () => exportDlg.close(),
        };
    }

    mountToolbarLayout();

    return {
        setTool, setPrimary, setColors, setHighlights, setSymmetry, setDiagonalEnabled,
        setHistory, syncNewInputs, closeNew: () => npWidget.hidePopover(),
        confirmDirty, openExport,
    };
}

// ─── Toolbar layout ──────────────────────────────────────────────────────────
// Each group is measured at full scale (--hit 2.25rem, --font-base 0.875rem)
// and at the minimum scale (2/3 those). From those two samples we derive:
//   • bpSingleRow_full — vp where all 5 groups fit on one row at full size
//   • bpTwoRow_full    — vp where the wider of the two narrow rows fits at full size
//   • bpTwoRow_min     — same at min scale (2/3 of full)
// Layout decisions:
//   • narrow-class on when vp < bpSingleRow_full
//   • below bpTwoRow_full, scale solves exactly for `width(scale) = vp`. The
//     two measurements give a linear `width(scale) = fixed + variable·scale`,
//     so the scale needed to fit any vp is `(vp − fixed) / variable`. No
//     floor: extreme zoom is the user's call.
const FULL_HIT = 36, FULL_HIT_SM = 28, FULL_FONT = 14;
// Second measurement point for the linear width(scale) model — not a clamp.
// Picking 2/3 gives a span wide enough that the linear approximation stays
// accurate for any scale we'd realistically need at runtime.
const LO_SAMPLE = 2 / 3;

function mountToolbarLayout() {
    const toolbar  = document.getElementById("toolbar") as HTMLElement;
    const groupSel = [".g-file", ".g-tools", ".g-sym", ".g-colors", ".g-hlrot"] as const;
    type Widths = Record<typeof groupSel[number], number>;

    let bpSingleRow_full = Infinity;
    let bpTwoRow_full    = 0;
    let bpTwoRow_min     = 0;

    function measureAtScale(scale: number): Widths {
        toolbar.style.setProperty("--hit",       `${FULL_HIT * scale}px`);
        toolbar.style.setProperty("--hit-sm",    `${FULL_HIT_SM * scale}px`);
        toolbar.style.setProperty("--font-base", `${FULL_FONT * scale}px`);
        void toolbar.offsetHeight;
        return Object.fromEntries(
            groupSel.map(s => [s, (document.querySelector(s) as HTMLElement).offsetWidth])
        ) as Widths;
    }

    function thresholds(w: Widths, padding: number, gap: number) {
        return {
            singleRow: padding + 4 * gap +
                w[".g-file"] + w[".g-tools"] + w[".g-sym"] + w[".g-colors"] + w[".g-hlrot"],
            twoRow: Math.max(
                padding + gap     + w[".g-file"]  + w[".g-hlrot"],
                padding + 2 * gap + w[".g-tools"] + w[".g-sym"] + w[".g-colors"],
            ),
        };
    }

    function measure() {
        // Measure outside the narrow layout so all 5 groups participate
        // directly in the toolbar's flex layout (display: contents on tb-row).
        const wasNarrow = toolbar.classList.contains("toolbar--narrow");
        toolbar.classList.remove("toolbar--narrow");

        const w_full = measureAtScale(1);
        const w_min  = measureAtScale(LO_SAMPLE);

        const cs = getComputedStyle(toolbar);
        const padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const gap     = parseFloat(cs.columnGap) || 0;

        const tFull = thresholds(w_full, padding, gap);
        const tMin  = thresholds(w_min,  padding, gap);
        bpSingleRow_full = tFull.singleRow;
        bpTwoRow_full    = tFull.twoRow;
        bpTwoRow_min     = tMin.twoRow;

        if (wasNarrow) toolbar.classList.add("toolbar--narrow");
    }

    function applyLayout() {
        const vp = window.innerWidth;
        toolbar.classList.toggle("toolbar--narrow", vp < bpSingleRow_full);

        let scale = 1;
        if (vp < bpTwoRow_full) {
            // Linear width(scale) = fixed + variable·scale, derived from the two
            // measurements (full at scale 1, min at scale 2/3). Solve for the
            // scale that makes width(scale) == vp.
            const variable = 3 * (bpTwoRow_full - bpTwoRow_min);
            const fixed    = bpTwoRow_full - variable;
            scale = variable > 0 ? (vp - fixed) / variable : 1;
            scale = Math.min(1, Math.max(0, scale));
        }
        toolbar.style.setProperty("--hit",       `${FULL_HIT    * scale}px`);
        toolbar.style.setProperty("--hit-sm",    `${FULL_HIT_SM * scale}px`);
        toolbar.style.setProperty("--font-base", `${FULL_FONT   * scale}px`);
    }

    function update() { measure(); applyLayout(); }

    update();
    window.addEventListener("resize", applyLayout);

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(update);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function bindBackdropClose(dlg: HTMLDialogElement) {
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
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
