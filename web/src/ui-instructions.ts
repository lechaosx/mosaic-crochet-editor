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
    const instructionErrors = el("instructions-errors");
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
        crochetMode.classList.toggle("btn--danger", !open && crochetErrors > 0);
        crochetMode.setAttribute("aria-pressed", String(open));
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
            liveProgress.textContent = `${current} / ${total}`;
            liveBack.disabled = isBusy || liveCompleted === 0;
            liveBack.setAttribute("aria-label", `Back one ${workKind()}`);
            liveBack.title = `Back one ${workKind()}`;
            liveForward.disabled = isBusy || total === 0 || liveCompleted >= total - 1;
            liveForward.setAttribute("aria-label", `Forward one ${workKind()}`);
            liveForward.title = `Forward one ${workKind()}`;
            unitElements.forEach((item, index) => {
                item.disabled = isBusy;
                item.classList.toggle("instructions-unit--complete", index < liveCompleted);
                item.classList.toggle(
                    "instructions-unit--current-invalid",
                    index === liveCompleted && Boolean(liveUnits[index]?.invalid),
                );
                if (index === liveCompleted) {
                    item.setAttribute("aria-current", "step");
                } else {
                    item.removeAttribute("aria-current");
                }
            });
            const currentUnit = liveUnits[liveCompleted] ?? null;
            currentInstruction.hidden = currentUnit === null;
            if (currentUnit) {
                currentInstructionText.textContent =
                    currentUnit.text.slice(currentUnit.text.indexOf(":") + 1).trim().replaceAll(" × ", "\u00a0×\u00a0");
            }
            livePreviewListeners.forEach(f => f(current));
            unitElements[Math.min(liveCompleted, total - 1)]?.scrollIntoView({ block: "nearest" });
        };
        const refreshCrochetAvailability = () => {
            if (!isBusy && liveUnits.length === 0) {
                liveUnavailable.textContent = "No instructions";
                liveUnavailable.hidden = false;
            } else {
                liveUnavailable.hidden = true;
            }
            liveBack.disabled = isBusy || liveCompleted === 0;
            liveForward.disabled = isBusy || liveUnits.length === 0
                || liveCompleted >= liveUnits.length - 1;
        };
        liveBack.onclick = () => {
            if (liveCompleted === 0) return;
            liveCompleted--;
            liveSaveWarning.hidden = liveProgressChanged(liveCompleted);
            renderCrochet();
        };
        liveForward.onclick = () => {
            if (liveCompleted >= liveUnits.length - 1) return;
            liveCompleted++;
            liveSaveWarning.hidden = liveProgressChanged(liveCompleted);
            renderCrochet();
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
                item.title = `Go to ${unit.label}, Yarn ${unit.yarn}${unit.invalid ? " · contains invalid placements" : ""}`;
                const index = unitElements.length;
                item.onclick = () => {
                    if (isBusy || index >= liveUnits.length) return;
                    liveCompleted = index;
                    liveSaveWarning.hidden = liveProgressChanged(liveCompleted);
                    renderCrochet();
                };
                const marker = item.querySelector<HTMLElement>(".instructions-unit-marker") ?? document.createElement("span");
                marker.className = "instructions-unit-marker";
                marker.setAttribute("aria-hidden", "true");
                const meta = item.querySelector<HTMLElement>(".instructions-unit-number") ?? document.createElement("span");
                meta.className = "instructions-unit-number";
                meta.style.backgroundColor = unit.color;
                meta.textContent = unit.label.replace(/^\D+/, "");
                meta.dataset.yarn = unit.yarn;
                const text = item.querySelector("code") ?? document.createElement("code");
                text.textContent = unit.text.slice(unit.text.indexOf(":") + 1).trim().replaceAll(" × ", "\u00a0×\u00a0");
                if (!item.parentElement) {
                    item.append(marker, meta, text);
                    row.append(item);
                    unitsList.append(row);
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
            setLivePlan: (units, completedUnits, onProgress) => {
                const labels = new Set(units.map(unit => unit.label));
                Array.from(unitsList.children).forEach(row => {
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
                liveSaveWarning.hidden = true;
                refreshCrochetAvailability();
                renderCrochet();
            },
            setErrors: (count) => {
                instructionErrors.textContent = count === 1 ? "1 invalid placement" : `${count} invalid placements`;
                instructionErrors.hidden = count === 0;
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
