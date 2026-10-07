import type { MirrorCenter } from "@mosaic/logic/types";
import { el, setMessage, iconAction, listRow, syncList, setPressed } from "./dom";
import { MIRROR_TYPES, mirrorTypePresentation } from "./mirror-presentation";
import type { UICallbacks, InspectorControls } from "./ui-types";

export function mountMirrors(
    cb: Pick<UICallbacks, "onAddMirror" | "onToggleMirror" | "onDeleteMirror" | "onSelectMirror" | "onMirrorType" | "onMirrorPosition" | "onReplicateSelection">,
    inspector: Pick<InspectorControls, "isOpen" | "close" | "open" | "focusFirst">) {
    const symList = el("sym-list");
    const symToggle = el("btn-sym-toggle");
    const transformError = el("transform-error");
    const editor = el("mirror-editor");
    const x = el<HTMLInputElement>("mirror-centre-x");
    const y = el<HTMLInputElement>("mirror-centre-y");
    let projectedMirrors: ReadonlyArray<MirrorCenter> = [];
    const selectedMirror = () => projectedMirrors.find(mirror => mirror.id === editor.dataset.mirrorId);
    symToggle.addEventListener("click", e => {
        e.preventDefault();
        if (inspector.isOpen("transforms")) inspector.close();
        else {
            inspector.open("transforms", "Global Mirror");
            inspector.focusFirst("transforms");
        }
    });
    el("add-mirror").addEventListener("click", () => cb.onAddMirror(null));
    const stamp = el<HTMLButtonElement>("replicate-selection");
    stamp.addEventListener("click", cb.onReplicateSelection);

    function setTransformState(hasSelection: boolean, hasTransforms: boolean) {
        stamp.disabled = !hasSelection || !hasTransforms;
        const stampTitle = !hasTransforms ? "Choose a Global Mirror type first"
            : !hasSelection ? "Select cells to stamp global mirror copies" : "Stamp the current selection through all enabled global mirrors (T)";
        if (stamp.title !== stampTitle) stamp.title = stampTitle;
        const state = hasTransforms ? "live" : "none";
        if (symToggle.dataset.transformState !== state) symToggle.dataset.transformState = state;
        const label = hasTransforms ? "Global Mirror: applying while drawing" : "Global Mirror: no active types";
        if (symToggle.title !== label) symToggle.title = label;
        if (symToggle.getAttribute("aria-label") !== label) symToggle.setAttribute("aria-label", label);
    }

    function setTransformError(message: string | null) {
        if (transformError.textContent !== (message ?? "") || transformError.hidden !== (message === null)) {
            setMessage(transformError, message);
        }
        if (message !== null && !inspector.isOpen("transforms")) inspector.open("transforms", "Global Mirror");
    }

    function resetFields() {
        const mirror = selectedMirror();
        if (mirror) { x.value = String(mirror.x); y.value = String(mirror.y); }
    }
    function applyPosition() {
        const mirror = selectedMirror();
        if (!mirror) return;
        if (!Number.isFinite(x.valueAsNumber) || !Number.isFinite(y.valueAsNumber)) {
            setTransformError("Enter a number for each centre coordinate.");
        } else cb.onMirrorPosition(mirror.id, { x: x.valueAsNumber, y: y.valueAsNumber });
        resetFields();
    }
    for (const input of [x, y]) input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); applyPosition(); }
        if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); resetFields();
        }
    });
    el("mirror-centre-apply").addEventListener("click", applyPosition);
    window.addEventListener("blur", resetFields);
    const position = (mirror: MirrorCenter) => `(${mirror.x}, ${mirror.y})`;
    const add = el<HTMLButtonElement>("add-mirror");
    function setMirrors(mirrors: ReadonlyArray<MirrorCenter>, selectedId: string | null) {
        projectedMirrors = mirrors;
        syncList<MirrorCenter | null>(symList, [...mirrors, null], "mirrorKey", mirror => mirror ? `saved:${mirror.id}` : "placeholder", mirror => {
            const row = document.createElement("div");
            if (!mirror) { row.className = "sym-list-placeholder"; row.append(add); return row; }
            row.className = "sym-list-row";
            row.dataset.mirrorId = mirror.id;
            const select = iconAction("transform", "Select mirror");
            select.dataset.mirrorAction = "select";
            select.className = "btn btn--ghost sym-list-row__select";
            const summary = document.createElement("span");
            summary.className = "sym-list-row__summary";
            select.append(summary);
            select.addEventListener("click", () => cb.onSelectMirror(mirror.id));
            const toggle = iconAction("check", "Enable mirror");
            toggle.dataset.mirrorAction = "toggle";
            toggle.addEventListener("click", () => cb.onToggleMirror(mirror.id));
            const del = iconAction("delete", "Delete mirror");
            del.dataset.mirrorAction = "delete";
            del.addEventListener("click", () => {
                const index = projectedMirrors.findIndex(value => value.id === mirror.id);
                const fallback = projectedMirrors[index + 1] ?? projectedMirrors[index - 1];
                cb.onDeleteMirror(mirror.id);
                if (fallback) listRow(symList, "mirrorId", fallback.id)?.querySelector<HTMLButtonElement>("[data-mirror-action='delete']")?.focus();
                else add.focus();
            });
            const types = document.createElement("div"); types.className = "mirror-type-choices";
            types.setAttribute("role", "group"); types.setAttribute("aria-label", "Mirror types");
            for (const type of MIRROR_TYPES) {
                const button = iconAction(`mirror-${type.key.toLowerCase()}`, type.name);
                button.dataset.mirrorType = type.key;
                button.addEventListener("click", () => { cb.onSelectMirror(mirror.id); cb.onMirrorType(mirror.id, type.key); });
                types.append(button);
            }
            row.append(select, toggle, del, types); return row;
        }, (row, mirror, index) => {
            if (!mirror) return;
            row.classList.toggle("is-inactive", !mirror.enabled);
            row.classList.toggle("is-selected", mirror.id === selectedId);
            const name = `Mirror ${index + 1}`;
            const coordinates = row.querySelector(".sym-list-row__summary")!;
            if (coordinates.textContent !== position(mirror)) coordinates.textContent = position(mirror);
            const summary = mirror.types.map(key => key === "C" ? "180°" : MIRROR_TYPES.find(type => type.key === key)!.name).join(" · ") || "No types chosen";
            const select = row.querySelector<HTMLButtonElement>("[data-mirror-action='select']")!;
            const selectTitle = `Select ${name} at ${position(mirror)}`;
            if (select.title !== selectTitle) select.title = selectTitle;
            if (select.getAttribute("aria-label") !== selectTitle) select.setAttribute("aria-label", selectTitle);
            if (select.getAttribute("aria-description") !== summary) select.setAttribute("aria-description", summary);
            setPressed(select, mirror.id === selectedId);
            for (const action of ["toggle", "delete"]) {
                const button = row.querySelector<HTMLButtonElement>(`[data-mirror-action='${action}']`)!;
                const title = `${action === "delete" ? "Delete" : mirror.enabled ? "Disable" : "Enable"} ${name} at ${position(mirror)}`;
                if (button.title !== title) button.title = title;
                if (button.getAttribute("aria-label") !== title) button.setAttribute("aria-label", title);
                if (button.getAttribute("aria-description") !== summary) button.setAttribute("aria-description", summary);
                if (action === "toggle") setPressed(button, mirror.enabled);
            }
            for (const type of mirrorTypePresentation(mirror.types)) {
                const button = row.querySelector<HTMLButtonElement>(`[data-mirror-type='${type.key}']`)!;
                setPressed(button, type.chosen);
                const effective = String(type.chosen || type.implied);
                if (button.dataset.effective !== effective) button.dataset.effective = effective;
                const description = type.implied ? "Implied by the chosen types. Click to choose directly."
                    : type.chosen ? "Chosen directly. Click to remove this type." : "Click to choose this type.";
                if (button.getAttribute("aria-description") !== description) button.setAttribute("aria-description", description);
                const title = `${type.name}. ${description}`;
                if (button.title !== title) button.title = title;
            }
        });
        const selected = mirrors.find(mirror => mirror.id === selectedId);
        if (editor.hidden !== !selected) editor.hidden = !selected;
        if (editor.dataset.mirrorId !== (selectedId ?? "")) editor.dataset.mirrorId = selectedId ?? "";
        if (selected) resetFields();
    }

    return { setMirrors, setTransformState, setTransformError };
}
