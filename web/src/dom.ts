export function el<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

export function inputValue(id: string): string { return el<HTMLInputElement>(id).value; }
export function inputInt(id: string):   number { return parseInt(inputValue(id)); }
