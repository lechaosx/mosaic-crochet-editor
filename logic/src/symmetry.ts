// Symmetry axes are first-class entries in `SessionState.axes`. The Rust
// orbit walker takes a flat `Float64Array` (3 doubles per active axis:
// `kind`, `a`, `b`); `axesToFlat` compiles the active set down. Composition
// of multiple reflections emerges from the BFS without implied axis records.

import { Axis, SymKey } from "./types";

export type { Axis, SymKey };

// Kind codes — must stay in lockstep with `KIND_*` in `core/src/tools.rs`.
const KIND_CODE: Record<SymKey, number> = {
    V: 0, H: 1, C: 2, D1: 3, D2: 4,
};

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

// ── Canonical-position factory ───────────────────────────────────────────────

function newAxisId(): string {
    return `axis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Build a fresh axis of the given kind at its canonical centre. Caller
// usually flips `active: true` on the result via the spread in `addAxis`.
// D1 / D2 round to the nearest integer because non-integer `c` would
// produce off-grid mirror partners.
function canonicalAxis(kind: SymKey, W: number, H: number): Axis {
    switch (kind) {
        case "V":  return { kind: "V",  id: newAxisId(), active: false, x: (W - 1) / 2 };
        case "H":  return { kind: "H",  id: newAxisId(), active: false, y: (H - 1) / 2 };
        case "C":  return { kind: "C",  id: newAxisId(), active: false, x: (W - 1) / 2, y: (H - 1) / 2 };
        case "D1": return { kind: "D1", id: newAxisId(), active: false, c: Math.round((W - H) / 2) };
        case "D2": return { kind: "D2", id: newAxisId(), active: false, c: Math.round((W + H - 2) / 2) };
    }
}

// Fresh sessions have no symmetry; migration callers also use this when an
// older saved value has no axis list.
export function defaultAxes(_canvasWidth: number, _canvasHeight: number): Axis[] {
    return [];
}

// Add a new axis of the given kind at its canonical centre, active.
// Pushes a fresh-id record; multiple axes of the same kind coexist.
export function addAxis(
    axes: ReadonlyArray<Axis>, kind: SymKey, canvasWidth: number, canvasHeight: number,
): Axis[] {
    return [...axes, { ...canonicalAxis(kind, canvasWidth, canvasHeight), active: true }];
}

// Remove an axis by id. No-op when the id is absent.
export function removeAxis(axes: ReadonlyArray<Axis>, id: string): Axis[] {
    return axes.filter(a => a.id !== id);
}

// Flip one axis's `active` by id. No-op when the id is absent.
export function toggleAxisActive(axes: ReadonlyArray<Axis>, id: string): Axis[] {
    return axes.map(a => a.id === id ? { ...a, active: !a.active } : a);
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

// True when the axis can't mirror two distinct in-canvas cells — i.e. the
// drag-to-delete trigger. "Touching the boundary" is dead because at the
// edge only a single cell can ever self-mirror (no useful pair). Per kind:
//   V  — useful iff a.x ∈ (0, W − 1). At a.x = 0 only cell 0 self-mirrors.
//   H  — symmetric on Y.
//   C  — rotation point; useful iff (a.x, a.y) ∈ (0, W − 1) × (0, H − 1).
//   D1 — line x − y = c; useful iff c ∈ (−(H − 1), W − 1).
//   D2 — line x + y = c; useful iff c ∈ (0, W + H − 2).
export function axisOffCanvas(a: Axis, W: number, H: number): boolean {
    switch (a.kind) {
        case "V":  return a.x <= 0 || a.x >= W - 1;
        case "H":  return a.y <= 0 || a.y >= H - 1;
        case "C":  return a.x <= 0 || a.x >= W - 1
                       || a.y <= 0 || a.y >= H - 1;
        case "D1": return a.c <= -(H - 1) || a.c >= W - 1;
        case "D2": return a.c <= 0 || a.c >= W + H - 2;
    }
}

// Pick at most ONE active axis per kind whose guide is within `tolerance`
// of the click. Multi-axis drag: clicking at an intersection grabs one of
// each kind. Two parallel V axes at the same x → only the closer one is
// returned so the user can drag it away to separate them.
export function pickAxesAt(
    axes: ReadonlyArray<Axis>, px: number, py: number, tolerance: number,
): Axis[] {
    const byKind = new Map<SymKey, { axis: Axis; dist: number }>();
    for (const a of axes) {
        if (!a.active) continue;
        const d = distanceToAxis(a, px, py);
        if (d >= tolerance) continue;
        const cur = byKind.get(a.kind);
        if (!cur || d < cur.dist) byKind.set(a.kind, { axis: a, dist: d });
    }
    return [...byKind.values()].map(v => v.axis);
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
