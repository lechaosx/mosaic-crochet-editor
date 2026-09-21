export type Tool   = "pencil" | "fill" | "eraser" | "invert" | "overlay" | "select" | "wand" | "move";
export type SymKey = "V" | "H" | "C" | "D1" | "D2";

// Axes carry kind-specific position fields. Each axis is independently
// togglable (`active`) and identifiable (`id`) for the symmetry list.
//
//   V  — vertical mirror line at x = (axis.x)
//   H  — horizontal mirror line at y = (axis.y)
//   D1 — diagonal x − y = c (slope +1 in pattern coords)
//   D2 — anti-diagonal x + y = c
//   C  — 180° rotation about the point (axis.x, axis.y)
export interface AxisV  { kind: "V";  id: string; active: boolean; x: number }
export interface AxisH  { kind: "H";  id: string; active: boolean; y: number }
export interface AxisD1 { kind: "D1"; id: string; active: boolean; c: number }
export interface AxisD2 { kind: "D2"; id: string; active: boolean; c: number }
export interface AxisC  { kind: "C";  id: string; active: boolean; x: number; y: number }
export type Axis = AxisV | AxisH | AxisD1 | AxisD2 | AxisC;

export interface GridRecipeSource {
    x:    number;
    y:    number;
    w:    number;
    h:    number;
    mask: Uint8Array;
}

export interface GridRecipe {
    id:                  string;
    enabled:             boolean;
    source:              GridRecipeSource;
    left:                number;
    right:               number;
    up:                  number;
    down:                number;
    columnSpacing:       number;
    rowSpacing:          number;
    columnOffset:        number;
    rowOffset:           number;
    columnOrientation:   "same" | "alternate-mirrored";
    rowOrientation:      "same" | "alternate-mirrored";
}

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
