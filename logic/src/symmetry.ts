// Symmetry: every axis is a first-class entry in `SessionState.axes`. The
// 5 canonical presets (V/H/C/D1/D2) are seeded by `defaultAxes`. The Rust
// orbit walker takes a flat `Float64Array` (3 doubles per active axis:
// `kind`, `a`, `b`); `axesToFlat` compiles the active set down. Closure
// semantics are now implicit — composition of two reflections emerges
// naturally from the BFS, so we don't pre-compute "implied" axes; the
// closure helper remains as a UI-only affordance.

import { Axis, SymKey } from "./types";

export type { Axis, SymKey };

// Kind codes — must stay in lockstep with `KIND_*` in `core/src/tools.rs`.
const KIND_CODE: Record<SymKey, number> = {
    V: 0, H: 1, C: 2, D1: 3, D2: 4,
};

export function diagonalsAvailable(canvasWidth: number, canvasHeight: number): boolean {
    return (canvasWidth - canvasHeight) % 2 === 0;
}

// Compile active axes to the flat `Float64Array` the Rust BFS takes. Each
// active axis contributes 3 doubles: `(kind, a, b)`. `a` is the primary
// scalar (x for V, y for H, c for D1/D2, x for C); `b` is unused except
// for C where it's the rotation point's y. Inactive axes are omitted.
export function axesToFlat(axes: ReadonlyArray<Axis>): Float64Array {
    const active = axes.filter(a => a.active);
    const out = new Float64Array(active.length * 3);
    for (let i = 0; i < active.length; i++) {
        const a = active[i];
        const off = i * 3;
        out[off] = KIND_CODE[a.kind];
        switch (a.kind) {
            case "V":  out[off + 1] = a.x; out[off + 2] = 0;   break;
            case "H":  out[off + 1] = a.y; out[off + 2] = 0;   break;
            case "C":  out[off + 1] = a.x; out[off + 2] = a.y; break;
            case "D1":
            case "D2": out[off + 1] = a.c; out[off + 2] = 0;   break;
        }
    }
    return out;
}

// Deactivate D1/D2 presets when the canvas can't represent diagonal mirrors
// at the canonical position. We deactivate rather than delete so the user
// keeps the preset around for when the canvas becomes diagonal-capable again.
export function pruneUnavailableDiagonals(
    axes: ReadonlyArray<Axis>, canvasWidth: number, canvasHeight: number,
): Axis[] {
    if (diagonalsAvailable(canvasWidth, canvasHeight)) return [...axes];
    return axes.map(a =>
        (a.kind === "D1" || a.kind === "D2") && a.active
            ? { ...a, active: false }
            : a
    );
}

// Sugar: which kinds are currently active? Used by the UI to drive the
// 5 toggle buttons (each tied to a preset axis kind).
export function activeKinds(axes: ReadonlyArray<Axis>): Set<SymKey> {
    const out = new Set<SymKey>();
    for (const a of axes) if (a.active) out.add(a.kind);
    return out;
}

// UI-only helper: which kinds appear in the orbit *transitively* given the
// directly-active set? V + H implies C; D1 + D2 implies C; etc. The BFS
// doesn't need this (composition emerges from the active-axis transforms),
// but the symmetry-panel buttons still want to dim-render "you're getting
// this for free" so the user can see derived axes. Slice A keeps this on
// canonical-position presets only; Slice B will need to reconsider for
// user-placed axes (where composition can land at arbitrary positions and
// the dim-button concept may not survive).
export function closureKinds(axes: ReadonlyArray<Axis>, canvasWidth: number, canvasHeight: number): Set<SymKey> {
    const active = activeKinds(axes);
    let V = active.has("V"), H = active.has("H"), C = active.has("C"),
        D1 = active.has("D1"), D2 = active.has("D2");
    const diagonals = diagonalsAvailable(canvasWidth, canvasHeight);
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

// ── Canonical-position factory ───────────────────────────────────────────────
// One preset per kind at the canonical (canvas-centred) position. Slice A
// guarantees these are the only axes that ever exist; Slice B adds the
// per-canvas-click "place a new axis" flow that produces additional entries.

function canonicalAxisV(W: number): Axis {
    return { kind: "V", id: "preset-V", active: false, x: (W - 1) / 2 };
}
function canonicalAxisH(H: number): Axis {
    return { kind: "H", id: "preset-H", active: false, y: (H - 1) / 2 };
}
function canonicalAxisC(W: number, H: number): Axis {
    return { kind: "C", id: "preset-C", active: false, x: (W - 1) / 2, y: (H - 1) / 2 };
}
function canonicalAxisD1(W: number, H: number): Axis {
    return { kind: "D1", id: "preset-D1", active: false, c: (W - H) / 2 };
}
function canonicalAxisD2(W: number, H: number): Axis {
    return { kind: "D2", id: "preset-D2", active: false, c: (W + H - 2) / 2 };
}

export function defaultAxes(canvasWidth: number, canvasHeight: number): Axis[] {
    return [
        canonicalAxisV(canvasWidth),
        canonicalAxisH(canvasHeight),
        canonicalAxisC(canvasWidth, canvasHeight),
        canonicalAxisD1(canvasWidth, canvasHeight),
        canonicalAxisD2(canvasWidth, canvasHeight),
    ];
}

// Distance (in cell-units) from a fractional pattern-space point to an axis.
// V/H lines: perpendicular distance. D1/D2: perpendicular distance scaled by √2.
// C: Euclidean distance to the rotation point.
export function distanceToAxis(a: Axis, px: number, py: number): number {
    switch (a.kind) {
        case "V":  return Math.abs(px - (a.x + 0.5));
        case "H":  return Math.abs(py - (a.y + 0.5));
        case "D1": return Math.abs(px - py - a.c)         / Math.SQRT2;
        case "D2": return Math.abs(px + py - (a.c + 1))   / Math.SQRT2;
        case "C":  return Math.hypot(px - (a.x + 0.5), py - (a.y + 0.5));
    }
}

// Pick the closest active axis whose guide is within `tolerance` cell-units
// of the click. Returns null when no axis is in range. Used by the Move-tool
// gesture to start an axis-drag instead of float-pickup.
export function pickAxisAt(
    axes: ReadonlyArray<Axis>, px: number, py: number, tolerance: number,
): Axis | null {
    let best: Axis | null = null;
    let bestDist = tolerance;
    for (const a of axes) {
        if (!a.active) continue;
        const d = distanceToAxis(a, px, py);
        if (d < bestDist) { bestDist = d; best = a; }
    }
    return best;
}

// Snap a scalar to the nearest half-integer (0, 0.5, 1, 1.5, …). Used for
// V/H/C axis dragging.
export function snapHalf(v: number): number {
    return Math.round(v * 2) / 2;
}

// Snap to nearest integer. Used for D1/D2 — diagonal axes only support
// integer `c` because non-integer `c` produces non-cell mirror partners.
export function snapInt(v: number): number {
    return Math.round(v);
}

// Update a single axis's position (immutable). Caller's responsibility to
// pass kind-appropriate fields (the discriminated union enforces it at the
// call site).
export function setAxisPosition(
    axes: ReadonlyArray<Axis>, id: string, pos: { x?: number; y?: number; c?: number },
): Axis[] {
    return axes.map(a => {
        if (a.id !== id) return a;
        switch (a.kind) {
            case "V":  return pos.x !== undefined ? { ...a, x: pos.x } : a;
            case "H":  return pos.y !== undefined ? { ...a, y: pos.y } : a;
            case "C":  return { ...a,
                                x: pos.x !== undefined ? pos.x : a.x,
                                y: pos.y !== undefined ? pos.y : a.y };
            case "D1":
            case "D2": return pos.c !== undefined ? { ...a, c: pos.c } : a;
        }
    });
}

// Flip one preset's `active`. Caller picks the kind; helper finds-or-no-ops.
// (Slice B will replace this with by-id; Slice A still tracks kinds because
// the existing UI buttons / shortcuts are kind-based.)
export function toggleAxisKind(axes: ReadonlyArray<Axis>, kind: SymKey): Axis[] {
    return axes.map(a => a.kind === kind ? { ...a, active: !a.active } : a);
}
