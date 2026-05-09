export function el<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

export function inputValue(id: string): string { return el<HTMLInputElement>(id).value; }
export function inputInt(id: string):   number { return parseInt(inputValue(id)); }
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
