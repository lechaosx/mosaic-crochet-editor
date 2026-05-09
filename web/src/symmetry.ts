import { SymKey } from "./types";
import { el } from "./dom";

export const SYM_IDS = ["sym-vertical", "sym-horizontal", "sym-central", "sym-diag1", "sym-diag2"];
export const SYM_KEY: Record<string, SymKey> = {
    "sym-vertical": "V", "sym-horizontal": "H", "sym-central": "C",
    "sym-diag1": "D1", "sym-diag2": "D2",
};

export let directlyActive = new Set<SymKey>();

export function computeClosure(active: Set<SymKey>, diagonals: boolean): Set<SymKey> {
    let V = active.has("V"), H = active.has("H"), C = active.has("C"),
        D1 = active.has("D1"), D2 = active.has("D2");
    let changed = true;
    while (changed) {
        const before = [V, H, C, D1, D2].join();
        if (V && H)    C  = true;
        if (V && C)    H  = true;
        if (H && C)    V  = true;
        if (D1 && D2)  C  = true;
        if (D1 && C)   D2 = true;
        if (D2 && C)   D1 = true;
        if (diagonals) {
            if (V && D1) D2 = true;
            if (V && D2) D1 = true;
            if (H && D1) D2 = true;
            if (H && D2) D1 = true;
        }
        changed = [V, H, C, D1, D2].join() !== before;
    }
    return new Set(
        (Object.entries({ V, H, C, D1, D2 }) as [SymKey, boolean][])
            .filter(([, v]) => v).map(([k]) => k)
    );
}

export function diagonalsAvailable(canvasWidth: number, canvasHeight: number): boolean {
    return (canvasWidth - canvasHeight) % 2 === 0;
}

export function closureToMask(closure: Set<SymKey>): number {
    let mask = 0;
    if (closure.has("V"))  mask |= 1;
    if (closure.has("H"))  mask |= 2;
    if (closure.has("C"))  mask |= 4;
    if (closure.has("D1")) mask |= 8;
    if (closure.has("D2")) mask |= 16;
    return mask;
}

export function getSymmetryMask(canvasWidth: number, canvasHeight: number): number {
    return closureToMask(computeClosure(directlyActive, diagonalsAvailable(canvasWidth, canvasHeight)));
}

export function updateSymmetryButtons(canvasWidth: number, canvasHeight: number) {
    const closure = computeClosure(directlyActive, diagonalsAvailable(canvasWidth, canvasHeight));
    Object.entries(SYM_KEY).forEach(([id, key]) => {
        const btn = el<HTMLButtonElement>(id);
        btn.classList.toggle("active",  directlyActive.has(key));
        btn.classList.toggle("implied", !directlyActive.has(key) && closure.has(key));
    });
}

export function updateDiagonalButtons(canvasWidth: number, canvasHeight: number) {
    const available = diagonalsAvailable(canvasWidth, canvasHeight);
    (["sym-diag1", "sym-diag2"] as const).forEach(id => {
        const btn = el<HTMLButtonElement>(id);
        btn.disabled = !available;
        if (!available) directlyActive.delete(SYM_KEY[id]);
    });
    updateSymmetryButtons(canvasWidth, canvasHeight);
}
