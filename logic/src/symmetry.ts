// Mirror centres compile to the existing Rust transform triplets; reflection
// composition remains in the authoritative orbit walker.

import { Axis, MirrorCenter, PatternState, SymKey } from "./types";

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

function canonicalAxis(kind: SymKey, W: number, H: number): Axis {
    switch (kind) {
        case "V":  return { kind: "V",  id: newAxisId(), active: false, x: (W - 1) / 2 };
        case "H":  return { kind: "H",  id: newAxisId(), active: false, y: (H - 1) / 2 };
        case "C":  return { kind: "C",  id: newAxisId(), active: false, x: (W - 1) / 2, y: (H - 1) / 2 };
        case "D1": return { kind: "D1", id: newAxisId(), active: false, c: Math.round((W - H) / 2) };
        case "D2": return { kind: "D2", id: newAxisId(), active: false, c: Math.round((W + H - 2) / 2) };
    }
}

// Legacy project bounds are preserved when deriving generators from centres.
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

export function axisIsProjectValid(axis: Axis, pattern: PatternState): boolean {
    const half = (value: number) => Number.isSafeInteger(value * 2);
    const whole = (value: number) => Number.isSafeInteger(value);
    const gridRepresentable = axis.kind === "V" ? half(axis.x)
        : axis.kind === "H" ? half(axis.y)
            : axis.kind === "C" ? half(axis.x) && half(axis.y)
                : whole(axis.c);
    return gridRepresentable
        && !axisOffCanvas(axis, pattern.canvasWidth, pattern.canvasHeight);
}

export function snapHalf(v: number): number {
    return Math.round(v * 2) / 2;
}

export function mirrorAxes(mirror: MirrorCenter): Axis[] {
    return mirror.types.map(kind => kind === "V" ? { id: mirror.id, active: mirror.enabled, kind, x: mirror.x }
        : kind === "H" ? { id: mirror.id, active: mirror.enabled, kind, y: mirror.y }
            : kind === "C" ? { id: mirror.id, active: mirror.enabled, kind, x: mirror.x, y: mirror.y }
                : { id: mirror.id, active: mirror.enabled, kind, c: kind === "D1" ? mirror.x - mirror.y : mirror.x + mirror.y });
}

export function mirrorsToFlat(mirrors: ReadonlyArray<MirrorCenter>): Float64Array {
    return axesToFlat(mirrors.flatMap(mirrorAxes));
}

export function migrateAxes(axes: ReadonlyArray<Axis>, pattern: PatternState): MirrorCenter[] {
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    return axes.map(axis => {
        let x = (W - 1) / 2, y = (H - 1) / 2;
        switch (axis.kind) {
            case "V": x = axis.x; break;
            case "H": y = axis.y; break;
            case "C": x = axis.x; y = axis.y; break;
            case "D1":
                x = (Math.max(0, axis.c) + Math.min(W - 1, H - 1 + axis.c)) / 2;
                y = x - axis.c;
                break;
            case "D2":
                x = (Math.max(0, axis.c - (H - 1)) + Math.min(W - 1, axis.c)) / 2;
                y = axis.c - x;
                break;
        }
        return { id: axis.id, enabled: axis.active, x, y, types: [axis.kind] };
    });
}

export function mirrorIsProjectValid(mirror: MirrorCenter, pattern: PatternState): boolean {
    return Number.isSafeInteger(mirror.x * 2) && Number.isSafeInteger(mirror.y * 2)
        && mirrorAxes(mirror).every(axis => axisIsProjectValid(axis, pattern));
}

export function mirrorsForPattern(mirrors: ReadonlyArray<MirrorCenter>, pattern: PatternState): MirrorCenter[] {
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    return mirrors.flatMap(mirror => {
        const types = mirrorAxes(mirror).filter(axis => axisIsProjectValid(axis, pattern)).map(axis => axis.kind);
        if (mirror.types.length > 0 && types.length === 0) return [];
        let x = mirror.x, y = mirror.y;
        const clampX = () => Math.max(0, Math.min(W - 1, x));
        const clampY = () => Math.max(0, Math.min(H - 1, y));
        if (types.length === 0) { x = clampX(); y = clampY(); }
        else if (types.length === 1 && types[0] === "V") y = clampY();
        else if (types.length === 1 && types[0] === "H") x = clampX();
        else if (types.length === 1 && (types[0] === "D1" || types[0] === "D2")
            && (x < 0 || x > W - 1 || y < 0 || y > H - 1)) {
            const axis = mirrorAxes({ ...mirror, types })[0];
            const midpoint = migrateAxes([axis], pattern)[0];
            x = midpoint.x; y = midpoint.y;
        }
        return [{ ...mirror, x, y, types }];
    });
}

export function snapMirrorCenter(mirror: MirrorCenter, position: { x: number; y: number }, pattern: PatternState): MirrorCenter | null {
    const insetX = mirror.types.includes("V") || mirror.types.includes("C") ? 0.5 : 0;
    const insetY = mirror.types.includes("H") || mirror.types.includes("C") ? 0.5 : 0;
    const maxX = pattern.canvasWidth - 1 - insetX, maxY = pattern.canvasHeight - 1 - insetY;
    if (maxX < insetX || maxY < insetY) return null;
    const x = snapHalf(Math.max(insetX, Math.min(maxX, position.x)));
    const y = snapHalf(Math.max(insetY, Math.min(maxY, position.y)));
    let closest: MirrorCenter | null = null, distance = Infinity;
    // A one-cell-wide chart needs a full-cell step to leave a diagonal boundary
    // while preserving parity; the fixed neighbourhood avoids chart-sized work.
    for (const dx of [0, -0.5, 0.5, -1, 1]) for (const dy of [0, -0.5, 0.5, -1, 1]) {
        const candidate = { ...mirror, x: x + dx, y: y + dy };
        if (candidate.x < insetX || candidate.x > maxX || candidate.y < insetY || candidate.y > maxY
            || !mirrorIsProjectValid(candidate, pattern)) continue;
        const d = (candidate.x - position.x) ** 2 + (candidate.y - position.y) ** 2;
        if (d < distance) { closest = candidate; distance = d; }
    }
    return closest;
}

export function addMirror(mirrors: ReadonlyArray<MirrorCenter>, kind: SymKey | null, pattern: PatternState): MirrorCenter[] {
    if (kind === null) return [...mirrors, { id: newAxisId(), enabled: true,
        x: (pattern.canvasWidth - 1) / 2, y: (pattern.canvasHeight - 1) / 2, types: [] }];
    const axis = { ...canonicalAxis(kind, pattern.canvasWidth, pattern.canvasHeight), active: true };
    if (!axisIsProjectValid(axis, pattern)) return [...mirrors];
    return [...mirrors, ...migrateAxes([axis], pattern)];
}

export function pickMirrorCenter(mirrors: ReadonlyArray<MirrorCenter>, px: number, py: number, tolerance: number, selectedId: string | null): MirrorCenter | null {
    let picked: MirrorCenter | null = null, distance = tolerance;
    for (const mirror of mirrors) {
        const d = Math.hypot(px - (mirror.x + 0.5), py - (mirror.y + 0.5));
        if (d < distance || (d === distance && mirror.id === selectedId)) { picked = mirror; distance = d; }
    }
    return picked;
}

export function readMirrorRecords(value: unknown): MirrorCenter[] | null {
    if (!Array.isArray(value)) return null;
    const ids = new Set<string>();
    const kinds: SymKey[] = ["V", "H", "C", "D1", "D2"];
    const mirrors: MirrorCenter[] = [];
    for (const item of value) {
        if (typeof item !== "object" || item === null || typeof item.id !== "string" || item.id.length === 0
            || ids.has(item.id) || typeof item.enabled !== "boolean"
            || !Number.isSafeInteger(item.x * 2) || !Number.isSafeInteger(item.y * 2)
            || typeof item.x !== "number" || typeof item.y !== "number"
            || !Array.isArray(item.types) || item.types.some((type: unknown) => !kinds.includes(type as SymKey))
            || new Set(item.types).size !== item.types.length) return null;
        ids.add(item.id);
        mirrors.push({ id: item.id, enabled: item.enabled, x: item.x, y: item.y, types: [...item.types] });
    }
    return mirrors;
}
