import { el } from "./dom";
import type { UICallbacks, InstructionsView, InstructionOverviewUnit } from "./ui-types";

export function mountInstructions(
    cb: Pick<UICallbacks, "onInstructions">, canvas: HTMLElement, beforeOpen: () => void,
    syncCanvasChromeInsets: () => void, queueCanvasChromeSync: () => void) {
    let closeInstructionsWorkspace: ((restoreFocus: boolean) => void) | null = null;
    /* ── Crochet workspace ──────────────────────────────────────────── */
    const instructions   = el("instructions-workspace");
    const unitsList      = el<HTMLOListElement>("instructions-units");
    const exportProgress = el("export-progress");
    const alternateChk   = el<HTMLInputElement>("alternate");
    const liveUnavailable = el("instructions-live-unavailable");
    const liveProgress   = el("instructions-live-progress");
    const liveSaveWarning = el("instructions-live-save-warning");
    const currentInstruction = el("instructions-current");
    const currentInstructionText = el("instructions-current-text");
    const liveBack       = el<HTMLButtonElement>("instructions-live-back");
    const liveForward    = el<HTMLButtonElement>("instructions-live-forward");
    const exportActionStatus = el("export-action-status");
    const crochetMode    = el<HTMLButtonElement>("btn-export");
    let hasCrochetProgress = false;
    let crochetErrors = 0;
    const setCrochetMode = (open: boolean) => {
        const label = open
            ? "Back to Design"
            : hasCrochetProgress ? "Continue Crocheting" : "Begin Crocheting";
        const errors = crochetErrors === 1 ? "1 invalid placement" : `${crochetErrors} invalid placements`;
        el("crochet-mode-label").textContent = label;
        crochetMode.title = (open
            ? "Return to pattern design"
            : hasCrochetProgress ? "Resume crochet progress" : "Start crochet instructions")
            + (!open && crochetErrors ? ` — ${errors}` : "");
        crochetMode.setAttribute("aria-label", `${label}${!open && crochetErrors ? ` — ${errors}` : ""}`);
        crochetMode.setAttribute("aria-pressed", String(open));
        crochetMode.classList.toggle("btn--danger", !open && crochetErrors > 0);
    };
    crochetMode.addEventListener("click", () => {
        if (closeInstructionsWorkspace) closeInstructionsWorkspace(true);
        else cb.onInstructions();
    });
    let instructionText = "";
    el("export-copy").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(instructionText);
            exportActionStatus.textContent = "Copied";
        } catch {
            exportActionStatus.textContent = "Copy failed";
        }
    });

    function openInstructions(): InstructionsView {
        const altListeners: (() => void)[] = [];
        const closeListeners: (() => void)[] = [];
        const livePreviewListeners: ((completedUnits: number | null) => void)[] = [];
        const unitElements: HTMLButtonElement[] = [];
        const unitRows = new Map<string, HTMLElement>();
        let liveUnits: readonly InstructionOverviewUnit[] = [];
        let liveCompleted = 0;
        let showWhole = false;
        const wholeRow = document.createElement("li");
        const wholeButton = document.createElement("button");
        wholeButton.type = "button";
        wholeButton.className = "instructions-unit instructions-unit--whole";
        wholeButton.textContent = "Pattern overview";
        wholeRow.append(wholeButton);
        let liveProgressChanged = (_completedUnits: number) => true;
        let isBusy = true;
        beforeOpen();
        unitsList.replaceChildren();
        const onAlt = () => altListeners.forEach(f => f());
        alternateChk.addEventListener("change", onAlt);
        canvas.removeAttribute("aria-describedby");
        canvas.setAttribute("aria-label", "Crochet progress chart");
        instructions.hidden = false;
        document.body.classList.add("crochet-mode");
        setCrochetMode(true);
        syncCanvasChromeInsets();
        queueCanvasChromeSync();
        instructions.focus();

        const workKind = () => liveUnits[0]?.label.startsWith("Round") ? "round" : "row";
        const renderCrochet = () => {
            const total = liveUnits.length;
            const current = total === 0 ? 0 : Math.min(liveCompleted + 1, total);
            liveProgress.textContent = showWhole && total > 0 ? "Pattern overview" : `${current} / ${total}`;
            liveBack.disabled = isBusy || total === 0;
            liveBack.setAttribute("aria-label", `Back one ${workKind()}`);
            liveBack.title = `Back one ${workKind()}`;
            liveForward.disabled = isBusy || total === 0;
            liveForward.setAttribute("aria-label", `Forward one ${workKind()}`);
            liveForward.title = `Forward one ${workKind()}`;
            unitElements.forEach((item, index) => {
                item.disabled = isBusy;
                item.classList.toggle("instructions-unit--complete", index < liveCompleted);
                item.classList.toggle(
                    "instructions-unit--current-invalid",
                    !showWhole && index === liveCompleted && Boolean(liveUnits[index]?.invalid),
                );
                if (!showWhole && index === liveCompleted) {
                    item.setAttribute("aria-current", "step");
                } else {
                    item.removeAttribute("aria-current");
                }
            });
            wholeButton.disabled = isBusy;
            wholeButton.classList.toggle("instructions-unit--current-invalid",
                showWhole && wholeButton.classList.contains("instructions-unit--invalid"));
            if (showWhole) wholeButton.setAttribute("aria-current", "step");
            else wholeButton.removeAttribute("aria-current");
            const currentUnit = liveUnits[liveCompleted] ?? null;
            currentInstruction.hidden = showWhole || currentUnit === null || isBusy;
            if (currentUnit) {
                currentInstructionText.textContent =
                    currentUnit.text.slice(currentUnit.text.indexOf(":") + 1).trim().replaceAll(" × ", "\u00a0×\u00a0");
            }
            if (!isBusy && total > 0) livePreviewListeners.forEach(f => f(showWhole ? null : current));
            syncCanvasChromeInsets();
            (showWhole ? wholeButton : unitElements[Math.min(liveCompleted, total - 1)])
                ?.scrollIntoView({ block: "nearest" });
        };
        const refreshCrochetAvailability = () => {
            if (!isBusy && liveUnits.length === 0) {
                liveUnavailable.textContent = "No instructions";
                liveUnavailable.hidden = false;
            } else {
                liveUnavailable.hidden = true;
            }
            liveBack.disabled = isBusy || liveUnits.length === 0;
            liveForward.disabled = isBusy || liveUnits.length === 0;
        };
        const select = (index: number | null) => {
            if (isBusy || liveUnits.length === 0) return;
            showWhole = index === null;
            if (index !== null) {
                liveCompleted = index;
                liveSaveWarning.hidden = liveProgressChanged(liveCompleted);
            }
            renderCrochet();
        };
        wholeButton.onclick = () => select(null);
        liveBack.onclick = () => select(showWhole ? liveUnits.length - 1 : liveCompleted === 0 ? null : liveCompleted - 1);
        liveForward.onclick = () => {
            select(showWhole ? 0 : liveCompleted >= liveUnits.length - 1 ? null : liveCompleted + 1);
        };

        const close = (restoreFocus = true) => {
            if (closeInstructionsWorkspace !== close) return;
            closeInstructionsWorkspace = null;
            alternateChk.removeEventListener("change", onAlt);
            liveBack.onclick = null;
            liveForward.onclick = null;
            canvas.setAttribute("aria-label", "Editable pattern chart");
            instructions.hidden = true;
            document.body.classList.remove("crochet-mode");
            setCrochetMode(false);
            syncCanvasChromeInsets();
            queueCanvasChromeSync();
            closeListeners.forEach(f => f());
            if (restoreFocus) crochetMode.focus();
        };
        closeInstructionsWorkspace = close;

        return {
            setProgress: (count, total) => {
                exportProgress.hidden = false;
                exportProgress.textContent = `Generating… ${count} / ${total}`;
            },
            endProgress: () => { exportProgress.hidden = true; },
            appendLine: (line) => {
                instructionText += (instructionText ? "\n" : "") + line;
            },
            appendUnit: (unit) => {
                const row = unitRows.get(unit.label) ?? document.createElement("li");
                unitRows.set(unit.label, row);
                row.dataset.instructionLabel = unit.label;
                const item = row.querySelector("button") ?? document.createElement("button");
                item.type = "button";
                item.disabled = isBusy;
                item.className = "instructions-unit";
                item.classList.toggle("instructions-unit--invalid", unit.invalid);
                item.setAttribute("aria-label", `${unit.label}, Yarn ${unit.yarn}${unit.invalid ? ", contains invalid placements" : ""}`);
                item.title = `${unit.label}, Yarn ${unit.yarn}${unit.invalid ? " · contains invalid placements" : ""}`;
                const index = unitElements.length;
                item.onclick = () => {
                    if (isBusy || index >= liveUnits.length) return;
                    select(index);
                };
                const meta = item.querySelector<HTMLElement>(".instructions-unit-number") ?? document.createElement("span");
                meta.className = "instructions-unit-number";
                meta.style.backgroundColor = unit.color;
                meta.textContent = unit.label.replace(/^\D+/, "");
                meta.dataset.yarn = unit.yarn;
                const text = item.querySelector("code") ?? document.createElement("code");
                text.textContent = unit.text.slice(unit.text.indexOf(":") + 1).trim().replaceAll(" × ", "\u00a0×\u00a0");
                if (!item.parentElement) {
                    item.append(meta, text);
                    row.append(item);
                    unitsList.insertBefore(row, wholeRow.parentElement ? wholeRow : null);
                }
                unitElements.push(item);
            },
            clearText: () => {
                instructionText = "";
                exportActionStatus.textContent = "";
            },
            clearUnits: () => {
                unitElements.length = 0;
                liveUnits = [];
                liveCompleted = 0;
                currentInstruction.hidden = true;
                refreshCrochetAvailability();
            },
            setLivePlan: (units, completedUnits, onProgress, wholeInvalid = false) => {
                const labels = new Set(units.map(unit => unit.label));
                Array.from(unitsList.children).forEach(row => {
                    if (row === wholeRow) return;
                    const label = (row as HTMLElement).dataset.instructionLabel!;
                    if (!labels.has(label)) {
                        row.remove();
                        unitRows.delete(label);
                    }
                });
                liveUnits = units;
                liveCompleted = units.length === 0
                    ? 0
                    : Math.min(Math.max(0, completedUnits), units.length - 1);
                liveProgressChanged = onProgress;
                if (units.length > 0) {
                    if (!wholeRow.parentElement) unitsList.append(wholeRow);
                } else {
                    wholeRow.remove();
                    showWhole = false;
                }
                wholeButton.classList.toggle("instructions-unit--invalid", wholeInvalid);
                wholeButton.setAttribute("aria-label", `Pattern overview${wholeInvalid ? ", contains invalid placements" : ""}`);
                wholeButton.title = `Pattern overview${wholeInvalid ? " · contains invalid placements outside the instructions" : ""}`;
                liveSaveWarning.hidden = true;
                refreshCrochetAvailability();
                renderCrochet();
            },
            setYarnColors: (a, b) => {
                unitElements.forEach(item => {
                    const marker = item.querySelector<HTMLElement>(".instructions-unit-number");
                    if (marker) marker.style.backgroundColor = marker.dataset.yarn === "A" ? a : b;
                });
            },
            alternate: () => alternateChk.checked,
            setBusy: (busy) => {
                isBusy = busy;
                el<HTMLButtonElement>("export-copy").disabled = busy;
                refreshCrochetAvailability();
                renderCrochet();
            },
            onAlternate: (f) => altListeners.push(f),
            onLivePreview: (f) => livePreviewListeners.push(f),
            onClose:     (f) => closeListeners.push(f),
            close,
        };
    }


    return { openInstructions, close: (restoreFocus: boolean) => closeInstructionsWorkspace?.(restoreFocus),
        setCrochetProgress: (hasProgress: boolean) => {
            hasCrochetProgress = hasProgress;
            if (!closeInstructionsWorkspace) setCrochetMode(false);
        }, setCrochetErrors: (count: number) => {
            crochetErrors = count;
            if (!closeInstructionsWorkspace) setCrochetMode(false);
        } };
}
