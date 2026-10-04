import type { MirrorCenter, SymKey } from "@mosaic/logic/types";
import { el, setMessage, iconAction, listRow, syncList, setPressed } from "./dom";
import type { UICallbacks, InspectorControls } from "./ui-types";

const TYPES: { key: SymKey; name: string; shortcut: string }[] = [
    { key: "V", name: "Vertical", shortcut: "V" },
    { key: "H", name: "Horizontal", shortcut: "H" },
    { key: "D1", name: "Diagonal", shortcut: "D" },
    { key: "D2", name: "Anti-diagonal", shortcut: "A" },
    { key: "C", name: "Point symmetry (180°)", shortcut: "C" },
];

export function mountMirrors(
    cb: Pick<UICallbacks, "onAddMirror" | "onToggleMirror" | "onDeleteMirror" | "onSelectMirror" | "onMirrorType" | "onMirrorPosition" | "onReplicateSelection">,
    inspector: Pick<InspectorControls, "isOpen" | "close" | "open" | "focusFirst">) {
    const symList = el("sym-list");
    const symToggle = el("btn-sym-toggle");
    const transformError = el("transform-error");
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
        stamp.title = !hasTransforms ? "Choose a Global Mirror type first"
            : !hasSelection ? "Select cells to stamp global mirror copies" : "Stamp global mirror copies from the current selection (T)";
        symToggle.dataset.transformState = hasTransforms ? "live" : "none";
        const label = hasTransforms ? "Global Mirror: applying while drawing" : "Global Mirror: no active types";
        symToggle.title = label;
        symToggle.setAttribute("aria-label", label);
    }

    function setTransformError(message: string | null) {
        setMessage(transformError, message);
        if (message !== null && !inspector.isOpen("transforms")) inspector.open("transforms", "Global Mirror");
    }

    const position = (mirror: MirrorCenter) => `(${mirror.x}, ${mirror.y})`;
    let projectedMirrors: ReadonlyArray<MirrorCenter> = [];
    window.addEventListener("blur", () => {
        for (const mirror of projectedMirrors) {
            listRow(symList, "mirrorId", mirror.id)?.querySelectorAll<HTMLInputElement>("input").forEach(input => {
                input.value = String(mirror[input.dataset.coordinate as "x" | "y"]);
            });
        }
    });
    function setMirrors(mirrors: ReadonlyArray<MirrorCenter>, selectedId: string | null) {
        projectedMirrors = mirrors;
        syncList(symList, mirrors, "mirrorKey", mirror => mirror.id, mirror => {
            const row = document.createElement("div");
            row.className = "sym-list-row";
            row.dataset.mirrorId = mirror.id;
            const select = iconAction("transform", `Select mirror at ${position(mirror)}`);
            select.dataset.mirrorAction = "select";
            select.addEventListener("click", () => cb.onSelectMirror(mirror.id));
            const pos = document.createElement("div");
            pos.className = "sym-list-row__pos";
            const summary = document.createElement("span");
            summary.textContent = position(mirror);
            const fields = document.createElement("div");
            fields.className = "sym-list-row__fields";
            const resetFields = () => {
                const current = projectedMirrors.find(value => value.id === mirror.id);
                if (current) fields.querySelectorAll<HTMLInputElement>("input").forEach(input => {
                    input.value = String(current[input.dataset.coordinate as "x" | "y"]);
                });
            };
            const applyPosition = () => {
                const x = fields.querySelector<HTMLInputElement>("[data-coordinate='x']")!.valueAsNumber;
                const y = fields.querySelector<HTMLInputElement>("[data-coordinate='y']")!.valueAsNumber;
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    setTransformError("Enter a number for each centre coordinate.");
                    resetFields();
                    return;
                }
                cb.onMirrorPosition(mirror.id, { x, y });
                resetFields();
            };
            for (const coordinate of ["x", "y"] as const) {
                const label = document.createElement("label");
                label.textContent = coordinate;
                const input = document.createElement("input");
                input.type = "number";
                input.step = "0.5";
                input.dataset.coordinate = coordinate;
                input.setAttribute("aria-label", `Mirror centre ${coordinate}`);
                input.addEventListener("keydown", event => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    applyPosition();
                });
                label.append(input);
                fields.append(label);
            }
            const apply = iconAction("check", "Apply centre position");
            apply.title = "Apply centre position (Enter)";
            apply.addEventListener("click", applyPosition);
            fields.append(apply);
            pos.append(summary, fields);
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
                else el<HTMLButtonElement>("add-mirror").focus();
            });
            const types = document.createElement("div");
            types.className = "sym-list-row__types toggle-group";
            types.setAttribute("role", "group");
            types.setAttribute("aria-label", "Mirror types");
            for (const type of TYPES) {
                const button = iconAction(`mirror-${type.key.toLowerCase()}`, type.name);
                button.title = `${type.name}; ${type.shortcut} adds a new mirror with this type`;
                button.dataset.mirrorType = type.key;
                button.addEventListener("click", () => cb.onMirrorType(mirror.id, type.key));
                types.append(button);
            }
            row.append(select, pos, toggle, del, types);
            return row;
        }, (row, mirror) => {
            row.classList.toggle("is-inactive", !mirror.enabled);
            row.classList.toggle("is-selected", mirror.id === selectedId);
            row.querySelector(".sym-list-row__pos > span")!.textContent = position(mirror);
            row.querySelectorAll<HTMLInputElement>("input").forEach(input => {
                input.value = String(mirror[input.dataset.coordinate as "x" | "y"]);
            });
            const select = row.querySelector<HTMLButtonElement>("[data-mirror-action='select']")!;
            select.title = `Select mirror at ${position(mirror)}`;
            select.setAttribute("aria-label", select.title);
            setPressed(select, mirror.id === selectedId);
            const toggle = row.querySelector<HTMLButtonElement>("[data-mirror-action='toggle']")!;
            setPressed(toggle, mirror.enabled);
            toggle.title = `${mirror.enabled ? "Disable" : "Enable"} mirror at ${position(mirror)}`;
            toggle.setAttribute("aria-label", toggle.title);
            const del = row.querySelector<HTMLButtonElement>("[data-mirror-action='delete']")!;
            del.title = `Delete mirror at ${position(mirror)}`;
            del.setAttribute("aria-label", del.title);
            row.querySelectorAll<HTMLButtonElement>("[data-mirror-type]").forEach(button =>
                setPressed(button, mirror.types.includes(button.dataset.mirrorType as SymKey)));
        });
    }

    return { setMirrors, setTransformState, setTransformError };
}
