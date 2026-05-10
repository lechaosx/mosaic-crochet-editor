export function el<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

export function inputValue(id: string): string { return el<HTMLInputElement>(id).value; }
export function inputInt(id: string):   number { return parseInt(inputValue(id)); }

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
