export function mountCoordinateEditor(
    row: HTMLElement, x: HTMLInputElement, y: HTMLInputElement,
    preview: (position: { x: number; y: number }) => void,
    commit: () => void, revert: () => void,
) {
    let editing = false;
    let owner: string | null = null;
    let position = { x: 0, y: 0 };
    const reset = () => { x.value = String(position.x); y.value = String(position.y); };
    const previewDraft = () => {
        if (Number.isFinite(x.valueAsNumber) && Number.isFinite(y.valueAsNumber)) preview({ x: x.valueAsNumber, y: y.valueAsNumber });
    };
    const finish = () => { if (!editing) return; commit(); editing = false; reset(); };
    for (const input of [x, y]) {
        input.addEventListener("input", () => { editing = true; previewDraft(); });
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") { event.preventDefault(); previewDraft(); finish(); }
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); revert(); editing = false; reset(); }
        });
    }
    row.addEventListener("focusout", event => { if (!row.contains(event.relatedTarget as Node)) finish(); });
    document.addEventListener("pointerdown", event => { if (!row.contains(event.target as Node)) finish(); }, true);
    window.addEventListener("blur", () => { if (editing) { revert(); editing = false; reset(); } });
    return {
        setPosition(id: string, next: { x: number; y: number }) {
            if (owner !== id) { editing = false; owner = id; }
            position = next;
            if (!editing) reset();
        },
    };
}
