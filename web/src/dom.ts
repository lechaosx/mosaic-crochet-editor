export function el<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

// Read an integer, clamping NaN/below-min to `min`. Does not mutate the field.
export function readClampedInt(id: string, min: number): number {
    const v = parseInt(el<HTMLInputElement>(id).value);
    return Number.isNaN(v) || v < min ? min : v;
}

// Mutate the field's displayed value to its clamped form.
export function clampInputDisplay(id: string, min: number) {
    const inp = el<HTMLInputElement>(id);
    const v = parseInt(inp.value);
    const clamped = Number.isNaN(v) || v < min ? min : v;
    if (String(clamped) !== inp.value) inp.value = String(clamped);
}
export function radioValue(name: string): string {
    const checked = document.querySelector<HTMLInputElement>(`[name="${name}"]:checked`);
    if (checked) return checked.value;
    // Fallback: return value of first radio in group (honours HTML default)
    const first = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (first) { first.checked = true; return first.value; }
    return "";
}
export function setRadio(name: string, value: string) {
    const radio = document.querySelector<HTMLInputElement>(`[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
}

export function setPressed(button: HTMLElement, pressed: boolean, className = "btn--active") {
    button.classList.toggle(className, pressed);
    button.setAttribute("aria-pressed", String(pressed));
}

export function setMessage(target: HTMLElement, message: string | null) {
    target.textContent = message ?? "";
    target.hidden = message === null;
}

export function icon(name: string): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("tool-icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.append(use);
    return svg;
}

export function iconAction(name: string, label: string, title = label): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "btn btn--icon";
    button.type = "button";
    button.append(icon(name));
    button.setAttribute("aria-label", label);
    button.title = title;
    return button;
}

export function syncList<T>(list: HTMLElement, items: readonly T[], key: string,
    id: (item: T) => string, create: (item: T) => HTMLElement,
    update: (row: HTMLElement, item: T, index: number) => void) {
    const remaining = new Map(Array.from(list.children, child => {
        const row = child as HTMLElement;
        return [row.dataset[key]!, row];
    }));
    const itemIds = new Set(items.map(id));
    remaining.forEach((row, rowId) => {
        if (!itemIds.has(rowId)) {
            row.remove();
            remaining.delete(rowId);
        }
    });
    items.forEach((item, index) => {
        const itemId = id(item);
        const row = remaining.get(itemId) ?? create(item);
        remaining.delete(itemId);
        row.dataset[key] = itemId;
        update(row, item, index);
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
    });
}

export function listRow(list: HTMLElement, key: string, id: string | undefined): HTMLElement | undefined {
    return Array.from(list.children).find(child => (child as HTMLElement).dataset[key] === id) as HTMLElement | undefined;
}
