import type { Axis, SymKey } from "@mosaic/logic/types";
import { el, setMessage, iconAction, listRow } from "./dom";
import type { UICallbacks, InspectorControls } from "./ui-types";

// ─── Global Mirror button ids ─────────────────────────────────────────────────
// One "Add <kind>" button per kind in the inspector's add row.
const SYM_ADD_BUTTONS: { id: string; key: SymKey; glyph: string }[] = [
    { id: "add-sym-v",  key: "V",  glyph: "↔" },
    { id: "add-sym-h",  key: "H",  glyph: "↕" },
    { id: "add-sym-c",  key: "C",  glyph: "⊕" },
    { id: "add-sym-d1", key: "D1", glyph: "╲" },
    { id: "add-sym-d2", key: "D2", glyph: "╱" },
];

export function mountMirrors(
    cb: Pick<UICallbacks, "onAddAxis" | "onToggleAxis" | "onDeleteAxis" | "onAxisPosition" | "onReplicateSelection">,
    inspector: Pick<InspectorControls, "isOpen" | "close" | "open" | "focusFirst">) {
    /* ── Global Mirror inspector ──────────────────────────────────────── */
    const symList    = el("sym-list");
    const symToggle  = el("btn-sym-toggle");

    symToggle.addEventListener("click", e => {
        e.preventDefault();
        if (inspector.isOpen("transforms")) inspector.close();
        else {
            inspector.open("transforms", "Global Mirror");
            inspector.focusFirst("transforms");
        }
    });

    SYM_ADD_BUTTONS.forEach(({ id, key }) =>
        el(id).addEventListener("click", () => cb.onAddAxis(key))
    );
    const replicateSelection = el<HTMLButtonElement>("replicate-selection");
    const transformError = el("transform-error");
    replicateSelection.addEventListener("click", cb.onReplicateSelection);
    function setTransformState(hasSelection: boolean, hasTransforms: boolean) {
        replicateSelection.disabled = !hasSelection || !hasTransforms;
        replicateSelection.title = !hasTransforms
            ? "Add a Global Mirror axis first"
            : !hasSelection ? "Select cells to apply Global Mirror" : "Apply Global Mirror (T)";
        const state = !hasTransforms ? "none" : "live";
        const label = state === "none"
            ? "Global Mirror: no axes configured"
            : "Global Mirror: applying while drawing";
        symToggle.dataset.transformState = state;
        symToggle.title = label;
        symToggle.setAttribute("aria-label", label);
    }

    function setTransformError(message: string | null) {
        setMessage(transformError, message);
        if (message !== null && !inspector.isOpen("transforms")) {
            inspector.open("transforms", "Global Mirror");
        }
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
    function axisField(a: Axis, coordinate: "x" | "y" | "c"): number {
        if (coordinate === "x" && "x" in a) return a.x;
        if (coordinate === "y" && "y" in a) return a.y;
        if (coordinate === "c" && "c" in a) return a.c;
        throw new Error("Axis coordinate does not match its kind.");
    }
    const KIND_GLYPH: Record<SymKey, string> = { V: "↔", H: "↕", C: "⊕", D1: "╲", D2: "╱" };
    const KIND_NAME: Record<SymKey, string> = {
        V: "vertical",
        H: "horizontal",
        C: "central",
        D1: "diagonal",
        D2: "anti-diagonal",
    };

    function setAxes(axes: ReadonlyArray<Axis>) {
        // Axis lists stay small in normal editor use, so rebuilding avoids
        // stateful DOM diffing without affecting interaction latency.
        symList.replaceChildren(...axes.map((a, index) => {
            const row = document.createElement("div");
            row.className = "sym-list-row" + (a.active ? "" : " is-inactive");
            row.dataset.axisId = a.id;

            const kind = document.createElement("span");
            kind.className = "sym-list-row__kind";
            kind.textContent = KIND_GLYPH[a.kind];

            const pos = document.createElement("div");
            pos.className = "sym-list-row__pos";
            const summary = document.createElement("span");
            summary.textContent = formatPosition(a);
            pos.append(summary);

            const fields = document.createElement("div");
            fields.className = "sym-list-row__fields";
            const coordinates: ("x" | "y" | "c")[] = a.kind === "C"
                ? ["x", "y"]
                : a.kind === "H" ? ["y"] : a.kind === "V" ? ["x"] : ["c"];
            for (const coordinate of coordinates) {
                const label = document.createElement("label");
                label.textContent = coordinate;
                const input = document.createElement("input");
                input.type = "number";
                input.step = coordinate === "c" ? "1" : "0.5";
                input.value = String(axisField(a, coordinate));
                input.setAttribute("aria-label", `${KIND_NAME[a.kind][0].toUpperCase()}${KIND_NAME[a.kind].slice(1)} axis ${coordinate} position`);
                input.addEventListener("change", () => {
                    const value = input.valueAsNumber;
                    if (!Number.isFinite(value)) {
                        input.value = String(axisField(a, coordinate));
                        return;
                    }
                    const updated = cb.onAxisPosition(a.id, { [coordinate]: value });
                    if (!updated) return;
                    input.value = String(axisField(updated, coordinate));
                    summary.textContent = formatPosition(updated);
                    const updatedDescription = `${KIND_NAME[updated.kind]} axis at ${formatPosition(updated)}`;
                    const toggle = row.querySelector<HTMLButtonElement>("[data-axis-action='toggle']")!;
                    const del = row.querySelector<HTMLButtonElement>("[data-axis-action='delete']")!;
                    toggle.title = `${updated.active ? "Disable" : "Enable"} ${updatedDescription}`;
                    toggle.setAttribute("aria-label", toggle.title);
                    del.title = `Delete ${updatedDescription}`;
                    del.setAttribute("aria-label", del.title);
                });
                label.append(input);
                fields.append(label);
            }
            pos.append(fields);

            const description = `${KIND_NAME[a.kind]} axis at ${formatPosition(a)}`;

            const toggle = iconAction(a.active ? "●" : "○", `${a.active ? "Disable" : "Enable"} ${description}`);
            toggle.type = "button";
            toggle.dataset.axisAction = "toggle";
            toggle.addEventListener("click", () => {
                cb.onToggleAxis(a.id);
                const replacement = listRow(symList, "axisId", a.id);
                replacement?.querySelector<HTMLButtonElement>("[data-axis-action='toggle']")?.focus();
            });

            const del = iconAction("×", `Delete ${description}`);
            del.type = "button";
            del.dataset.axisAction = "delete";
            del.addEventListener("click", () => {
                const fallback = axes[index + 1] ?? axes[index - 1];
                cb.onDeleteAxis(a.id);
                if (fallback) {
                    const replacement = listRow(symList, "axisId", fallback.id);
                    replacement?.querySelector<HTMLButtonElement>("[data-axis-action='delete']")?.focus();
                } else {
                    const addButton = SYM_ADD_BUTTONS.find(button => button.key === a.kind)!;
                    el<HTMLButtonElement>(addButton.id).focus();
                }
            });

            row.append(kind, pos, toggle, del);
            return row;
        }));
    }

    return { setAxes, setTransformState, setTransformError };
}
