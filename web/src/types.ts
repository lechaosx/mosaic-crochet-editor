export type Tool   = "pencil" | "fill" | "eraser";
export type SymKey = "V" | "H" | "C" | "D1" | "D2";
export type Point  = [number, number];

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

export interface PointerLike { clientX: number; clientY: number; }
