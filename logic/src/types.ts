export type Tool   = "pencil" | "fill" | "eraser" | "invert" | "overlay" | "select" | "wand" | "move";
export type SymKey = "V" | "H" | "C" | "D1" | "D2";

// A "float" is a lifted selection layer positioned at absolute canvas-cell
// coordinates (x, y). Cells outside the canvas bounds are valid — floats
// can live in the off-canvas scratch area. `pixels` is a w×h row-major
// array: 0 = absent (not in float), 1 = color A, 2 = color B. There is no
// separate mask — `pixels[i] !== 0` determines membership.
export interface Float {
    x:      number;      // top-left in canvas-cell coords, can be negative / > W
    y:      number;
    w:      number;      // bounding box width
    h:      number;      // bounding box height
    pixels: Uint8Array;  // w×h, 0=absent, 1=A, 2=B
}

// A named library item wrapping a float parked in the scratch area.
export interface LibItem {
    id:    string;
    float: Float;
    name?: string;
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
