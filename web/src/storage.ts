import { el, inputValue } from "./dom";

const SAVE_KEY = "mosaic-pattern-v1";

type UiState = Record<string, string>;

export function saveToLocalStorage(pixels: Uint8Array) {
    const uiState: UiState = {
        mode:        inputValue("mode"),
        width:       inputValue("width"),
        height:      inputValue("height"),
        innerWidth:  inputValue("inner-width"),
        innerHeight: inputValue("inner-height"),
        rounds:      inputValue("rounds"),
        subMode:     inputValue("sub-mode"),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify({ uiState, pixels: Array.from(pixels) }));
}

export function loadFromLocalStorage(): { uiState: UiState; pixels: Uint8Array } | null {
    const saved = localStorage.getItem(SAVE_KEY);
    if (!saved) return null;
    try {
        const { uiState, pixels: savedPixels } = JSON.parse(saved);
        return { uiState, pixels: new Uint8Array(savedPixels) };
    } catch { return null; }
}

export function restoreUiState(uiState: UiState) {
    (el<HTMLInputElement>("mode")).value         = uiState.mode;
    (el<HTMLInputElement>("width")).value        = uiState.width;
    (el<HTMLInputElement>("height")).value       = uiState.height;
    (el<HTMLInputElement>("inner-width")).value  = uiState.innerWidth;
    (el<HTMLInputElement>("inner-height")).value = uiState.innerHeight;
    (el<HTMLInputElement>("rounds")).value       = uiState.rounds;
    (el<HTMLSelectElement>("sub-mode")).value    = uiState.subMode;
    el("row-controls").hidden   = uiState.mode !== "row";
    el("round-controls").hidden = uiState.mode !== "round";
}
