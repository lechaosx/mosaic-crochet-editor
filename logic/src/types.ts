export type Tool   = "pencil" | "fill" | "eraser" | "invert" | "overlay" | "select" | "wand" | "move";
export type SymKey = "V" | "H" | "C" | "D1" | "D2";

// Axes carry kind-specific position fields. Each axis is independently
// togglable (`active`) and identifiable (`id`) so future UI rows can render
// per-axis toggles + delete buttons.
//
//   V  — vertical mirror line at x = (axis.x)
//   H  — horizontal mirror line at y = (axis.y)
//   D1 — diagonal x − y = c (slope +1 in pattern coords)
//   D2 — anti-diagonal x + y = c
//   C  — 180° rotation about the point (axis.x, axis.y)
//
// In Slice A of Phase 4 every axis lives at its canonical (canvas-centred)
// position; the position fields are stored but the Rust BFS still uses the
// hard-coded `width-1-x` / etc. reflections via a u8 bitmask compiled from
// `kind` + `active`. Slice B (placement UI) is what will actually consume
// the position fields and pass them down.
export interface AxisV  { kind: "V";  id: string; active: boolean; x: number }
export interface AxisH  { kind: "H";  id: string; active: boolean; y: number }
export interface AxisD1 { kind: "D1"; id: string; active: boolean; c: number }
export interface AxisD2 { kind: "D2"; id: string; active: boolean; c: number }
export interface AxisC  { kind: "C";  id: string; active: boolean; x: number; y: number }
export type Axis = AxisV | AxisH | AxisD1 | AxisD2 | AxisC;

// A "float" is a lifted selection layer positioned at absolute canvas-cell
// coordinates (x, y). `pixels` is a w×h row-major array: 0 = absent (not in
// float), 1 = color A, 2 = color B. There is no separate mask —
// `pixels[i] !== 0` determines membership.
export interface Float {
    x:      number;      // top-left in canvas-cell coords, can be negative / > W
    y:      number;
    w:      number;      // bounding box width
    h:      number;      // bounding box height
    pixels: Uint8Array;  // w×h, 0=absent, 1=A, 2=B
}

export interface RowState {
    mode:         "row";
    canvasWidth:  number;
    canvasHeight: number;
}

export interface RoundState {
    mode:          "round";
    canvasWidth:   number;
    canvasHeight:  number;
    virtualWidth:  number;
    virtualHeight: number;
    offsetX:       number;
    offsetY:       number;
    rounds:        number;
}

export type PatternState = RowState | RoundState;
