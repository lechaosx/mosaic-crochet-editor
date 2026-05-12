// Pure symmetry helpers. Caller owns the directly-active set and passes it in.

import { SymKey } from "./types";

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

function closureToMask(closure: Set<SymKey>): number {
    let mask = 0;
    if (closure.has("V"))  mask |= 1;
    if (closure.has("H"))  mask |= 2;
    if (closure.has("C"))  mask |= 4;
    if (closure.has("D1")) mask |= 8;
    if (closure.has("D2")) mask |= 16;
    return mask;
}

export function getSymmetryMask(active: Set<SymKey>, canvasWidth: number, canvasHeight: number): number {
    return closureToMask(computeClosure(active, diagonalsAvailable(canvasWidth, canvasHeight)));
}

// Drop diagonals if no longer available for the new canvas size. Returns a
// new set (caller decides whether to swap it in).
export function pruneUnavailableDiagonals(
    active: Set<SymKey>, canvasWidth: number, canvasHeight: number,
): Set<SymKey> {
    if (diagonalsAvailable(canvasWidth, canvasHeight)) return active;
    const next = new Set(active);
    next.delete("D1");
    next.delete("D2");
    return next;
}
