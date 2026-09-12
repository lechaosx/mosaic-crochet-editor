import { Tool, SymKey, PatternState, Axis } from "@mosaic/logic/types";
import { el, setRadio, clampInputDisplay, radioValue } from "./dom";

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

// ─── Symmetry-popover button ids ──────────────────────────────────────────────
// One "Add <kind>" button per kind in the popover's add row.
const SYM_ADD_BUTTONS: { id: string; key: SymKey; glyph: string }[] = [
    { id: "add-sym-v",  key: "V",  glyph: "↔" },
    { id: "add-sym-h",  key: "H",  glyph: "↕" },
    { id: "add-sym-c",  key: "C",  glyph: "⊕" },
    { id: "add-sym-d1", key: "D1", glyph: "╲" },
    { id: "add-sym-d2", key: "D2", glyph: "╱" },
];

// ─── Public surface ───────────────────────────────────────────────────────────
export interface UICallbacks {
    onTool:            (t: Tool) => void;
    onMaskMove:        () => void;
    onPrimaryColor:    (slot: 1 | 2) => void;
    onColorChange:     () => void;
    onColorCommit:     () => void;
    onAddAxis:         (k: SymKey) => void;
    onToggleAxis:      (id: string) => void;
    onDeleteAxis:      (id: string) => void;
    onReplicateSelection: () => void;
    onHighlightChange:        () => void;
    onInvalidIntensityChange: () => void;
    onLabelsVisibleChange:    () => void;
    onLockInvalidChange: () => void;
    onUndo:            () => void;
    onRedo:            () => void;
    onRotate:          (delta: number) => void;
    onEditOpen:        () => void;
    onEditChange:      () => void;
    onEditClose:       () => void;
    onSave:            () => void;
    onLoad:            () => void;
    onExport:          () => void;
}

export interface UIHandle {
    setTool:            (t: Tool) => void;
    setMaskMove:        (active: boolean) => void;
    setPrimary:         (slot: 1 | 2) => void;
    setColors:          (a: string, b: string) => void;
    setAxes:            (axes: ReadonlyArray<Axis>) => void;
    setCanReplicateSelection: (enabled: boolean) => void;
    setHistory:         (undo: boolean, redo: boolean) => void;
    setEditError:       (message: string | null) => void;
    syncEditInputs:     (s: PatternState) => void;
    closeEdit:          () => void;
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
        pencil:  el("tool-pencil"),
        fill:    el("tool-fill"),
        eraser:  el("tool-eraser"),
        overlay: el("tool-overlay"),
        invert:  el("tool-invert"),
        select:  el("tool-select"),
        wand:    el("tool-wand"),
        move:    el("tool-move"),
    };
    (Object.keys(toolButtons) as Tool[]).forEach(t =>
        toolButtons[t].addEventListener("click", () => cb.onTool(t))
    );
    const maskMove = el<HTMLButtonElement>("move-mask");
    maskMove.addEventListener("click", cb.onMaskMove);

    function setTool(t: Tool) {
        (Object.keys(toolButtons) as Tool[]).forEach(k =>
            toolButtons[k].classList.toggle("btn--active", k === t)
        );
    }
    function setMaskMove(active: boolean) {
        maskMove.classList.toggle("btn--active", active);
        maskMove.setAttribute("aria-pressed", String(active));
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
    colorA.addEventListener("input",  cb.onColorChange);
    colorB.addEventListener("input",  cb.onColorChange);
    // `change` fires when the picker closes — that's the user's "I'm done"
    // signal and the right moment to push a history snapshot.
    colorA.addEventListener("change", cb.onColorCommit);
    colorB.addEventListener("change", cb.onColorCommit);

    function setPrimary(slot: 1 | 2) {
        swatchA.classList.toggle("swatch--active", slot === 1);
        swatchB.classList.toggle("swatch--active", slot === 2);
    }
    function setColors(a: string, b: string) {
        colorA.value = a; colorB.value = b;
        swatchA.style.background = a;
        swatchB.style.background = b;
    }

    /* ── Symmetry popover ─────────────────────────────────────────────── */
    const symPopover = el("sym-popover");
    const symList    = el("sym-list");
    const symToggle  = el("btn-sym-toggle");

    symToggle.addEventListener("click", e => {
        e.preventDefault();
        if (symPopover.matches(":popover-open")) { symPopover.hidePopover(); return; }
        positionPopover(symPopover, symToggle, "right");
        symPopover.showPopover();
    });

    SYM_ADD_BUTTONS.forEach(({ id, key }) =>
        el(id).addEventListener("click", () => cb.onAddAxis(key))
    );
    const replicateSelection = el<HTMLButtonElement>("replicate-selection");
    replicateSelection.addEventListener("click", cb.onReplicateSelection);

    function setCanReplicateSelection(enabled: boolean) {
        replicateSelection.disabled = !enabled;
    }

    function formatPosition(a: Axis): string {
        switch (a.kind) {
            case "V":  return `x=${a.x}`;
            case "H":  return `y=${a.y}`;
            case "C":  return `(${a.x}, ${a.y})`;
            case "D1":
            case "D2": return `c=${a.c}`;
        }
    }
    const KIND_GLYPH: Record<SymKey, string> = { V: "↔", H: "↕", C: "⊕", D1: "╲", D2: "╱" };

    function setAxes(axes: ReadonlyArray<Axis>) {
        // Axis lists stay small in normal editor use, so rebuilding avoids
        // stateful DOM diffing without affecting interaction latency.
        symList.replaceChildren(...axes.map(a => {
            const row = document.createElement("div");
            row.className = "sym-list-row" + (a.active ? "" : " is-inactive");
            row.dataset.axisId = a.id;

            const kind = document.createElement("span");
            kind.className = "sym-list-row__kind";
            kind.textContent = KIND_GLYPH[a.kind];

            const pos = document.createElement("span");
            pos.className = "sym-list-row__pos";
            pos.textContent = formatPosition(a);

            const toggle = document.createElement("button");
            toggle.className = "btn btn--icon";
            toggle.type = "button";
            toggle.title = a.active ? "Disable axis" : "Enable axis";
            toggle.textContent = a.active ? "●" : "○";
            toggle.addEventListener("click", () => cb.onToggleAxis(a.id));

            const del = document.createElement("button");
            del.className = "btn btn--icon";
            del.type = "button";
            del.title = "Delete axis";
            del.setAttribute("aria-label", "Delete axis");
            del.textContent = "×";
            del.addEventListener("click", () => cb.onDeleteAxis(a.id));

            row.append(kind, pos, toggle, del);
            return row;
        }));
    }
    /* ── Highlight popover ────────────────────────────────────────────── */
    const hlPopover = el("hl-popover");

    el("btn-hl-toggle").addEventListener("click", e => {
        // Intercept the popovertarget toggle so we can position before showing.
        e.preventDefault();
        if (hlPopover.matches(":popover-open")) { hlPopover.hidePopover(); return; }
        positionPopover(hlPopover, el("btn-hl-toggle"), "right");
        hlPopover.showPopover();
    });
    el<HTMLInputElement>("hl-opacity")        .addEventListener("input",  cb.onHighlightChange);
    el<HTMLInputElement>("invalid-intensity") .addEventListener("input",  cb.onInvalidIntensityChange);
    el<HTMLInputElement>("labels-on")   .addEventListener("change", cb.onLabelsVisibleChange);
    el<HTMLInputElement>("lock-invalid").addEventListener("change", cb.onLockInvalidChange);

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

    /* ── Pattern (Edit) popover ──────────────────────────────────────── */
    const editWidget = el("edit-pattern-widget");
    const btnEdit    = el<HTMLButtonElement>("btn-edit");
    const editError  = el("edit-error");

    function setEditError(message: string | null) {
        editError.textContent = message ?? "";
        editError.hidden = message === null;
    }

    btnEdit.addEventListener("click", e => {
        e.preventDefault();
        if (editWidget.matches(":popover-open")) { editWidget.hidePopover(); return; }
        positionPopover(editWidget, btnEdit, "left");
        editWidget.showPopover();
        cb.onEditOpen();
    });

    let editOpenState: PatternState | null = null;

    // "Wipe" is forced ON (visibly checked, disabled) only for mode switches —
    // row ↔ round can't preserve content. Inner-dim and rounds changes within
    // the same mode are handled by the round-mode corner/strip transfer (see
    // `preserveRound` in pattern.ts) and need no force.
    //
    // When force kicks in we stash the user's actual preference on the
    // element's dataset and tick the checkbox so the disabled state
    // communicates *which way* it's forced. When force lifts, restore the
    // stashed preference. The user's choice is never lost, just suppressed.
    function refreshWipeAvailability() {
        if (!editOpenState) return;
        const newMode = radioValue("edit-mode");
        const force = newMode !== editOpenState.mode;
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        if (force) {
            if (wipeEl.dataset.userPref === undefined) {
                wipeEl.dataset.userPref = wipeEl.checked ? "1" : "0";
            }
            wipeEl.checked = true;
        } else if (wipeEl.dataset.userPref !== undefined) {
            wipeEl.checked = wipeEl.dataset.userPref === "1";
            delete wipeEl.dataset.userPref;
        }
        wipeEl.disabled = force;
    }

    document.querySelectorAll<HTMLInputElement>('[name="edit-mode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            const mode = radio.value;
            el("edit-row-controls")  .hidden = mode !== "row";
            el("edit-round-controls").hidden = mode !== "round";
            refreshWipeAvailability();
            if (editWidget.matches(":popover-open")) cb.onEditChange();
        });
    });
    document.querySelectorAll<HTMLInputElement>('[name="edit-submode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            if (editWidget.matches(":popover-open")) cb.onEditChange();
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
        const apply = () => {
            refreshWipeAvailability();
            if (editWidget.matches(":popover-open")) cb.onEditChange();
        };
        el(id).addEventListener("input", apply);
        el(id).addEventListener("change", () => {
            clampInputDisplay(id, min);
            apply();
        });
    });
    el<HTMLInputElement>("edit-wipe").addEventListener("change", () => {
        if (editWidget.matches(":popover-open")) cb.onEditChange();
    });

    // Light-dismiss (Esc, outside click) is the commit path — onEditClose
    // pushes the current preview onto history. Undo (Ctrl+Z) is the revert.
    editWidget.addEventListener("toggle", e => {
        if ((e as ToggleEvent).newState === "closed") cb.onEditClose();
    });

    function syncEditInputs(s: PatternState) {
        editOpenState = s;
        setEditError(null);
        setRadio("edit-mode", s.mode);
        el("edit-row-controls")  .hidden = s.mode !== "row";
        el("edit-round-controls").hidden = s.mode !== "round";
        if (s.mode === "row") {
            el<HTMLInputElement>("edit-width") .value = String(s.canvasWidth);
            el<HTMLInputElement>("edit-height").value = String(s.canvasHeight);
        } else {
            const innerW = s.virtualWidth  - s.rounds * 2;
            const innerH = s.virtualHeight - s.rounds * 2;
            const sub = s.offsetX === 0 && s.offsetY === 0
                ? "full"
                : s.canvasWidth === s.virtualWidth ? "half" : "quarter";
            setRadio("edit-submode", sub);
            el<HTMLInputElement>("edit-inner-width") .value = String(innerW);
            el<HTMLInputElement>("edit-inner-height").value = String(innerH);
            el<HTMLInputElement>("edit-rounds")      .value = String(s.rounds);
        }
        // Each fresh popover open resets the user preference to "preserve"
        // (i.e. Wipe unchecked) and drops any stashed force-state from the
        // previous open.
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        delete wipeEl.dataset.userPref;
        wipeEl.checked = false;
        refreshWipeAvailability();
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
        setTool, setMaskMove, setPrimary, setColors, setAxes, setCanReplicateSelection,
        setHistory, setEditError,
        syncEditInputs, closeEdit: () => editWidget.hidePopover(),
        openExport,
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
    const groupSel = [".g-file", ".g-paint", ".g-transform", ".g-colors", ".g-hlrot"] as const;
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
                w[".g-file"] + w[".g-paint"] + w[".g-transform"] + w[".g-colors"] + w[".g-hlrot"],
            twoRow: Math.max(
                padding + gap     + w[".g-file"]   + w[".g-hlrot"],
                padding + 2 * gap + w[".g-paint"]  + w[".g-transform"] + w[".g-colors"],
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
