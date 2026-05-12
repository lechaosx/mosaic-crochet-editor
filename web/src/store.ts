// Single mutable owner for editor session state. Mutations go through
// `commit(mutate, opts?)` — the only place where the recompute → render →
// history → persist → observers chain runs. Direct mutation of `store.state`
// is a bug; the type is `Readonly<SessionState>` so the compiler will flag it.
//
// Ephemeral state stays outside the Store:
//   • view pan/zoom + animation state — render.ts (perf-sensitive)
//   • stroke state (preStroke, invertVisited, strokeColor) — main.ts (per-stroke)

import {
    build_highlight_plan_row,
    build_highlight_plan_round,
} from "@mosaic/wasm";
import { Tool, PatternState, SymKey } from "./types";

export interface SessionState {
    pattern:       PatternState;
    pixels:        Uint8Array;
    colorA:        string;               // hex
    colorB:        string;               // hex
    activeTool:    Tool;
    primaryColor:  1 | 2;
    symmetry:      Set<SymKey>;          // directly active axes
    hlOpacity:     number;               // 0..100, matches the input range
    labelsVisible: boolean;
    lockInvalid:   boolean;
    rotation:      number;               // degrees (target — render.ts animates the visual)
}

export interface CommitOpts {
    recompute?: boolean;   // rebuild highlight plan      (default: true)
    render?:    boolean;   // call the registered renderer (default: true)
    history?:   boolean;   // push snapshot to undo stack  (default: false)
    persist?:   boolean;   // write to localStorage        (default: true)
}

export type RenderFn   = (store: Store) => void;
export type ObserverFn = (store: Store) => void;
export type HistoryFn  = (s: Readonly<SessionState>) => void;
export type PersistFn  = (s: Readonly<SessionState>) => void;

function computePlan(s: SessionState): Int16Array {
    const p = s.pattern;
    return p.mode === "row"
        ? build_highlight_plan_row(s.pixels, p.canvasWidth, p.canvasHeight).slice()
        : build_highlight_plan_round(
            s.pixels, p.canvasWidth, p.canvasHeight,
            p.virtualWidth, p.virtualHeight,
            p.offsetX, p.offsetY, p.rounds,
        ).slice();
}

export class Store {
    private _state: SessionState;
    private _plan:  Int16Array;
    private _renderer:  RenderFn  | null = null;
    private _historyFn: HistoryFn | null = null;
    private _persistFn: PersistFn | null = null;
    private _observers: ObserverFn[] = [];

    constructor(state: SessionState) {
        this._state = state;
        this._plan  = computePlan(state);
    }

    get state(): Readonly<SessionState> { return this._state; }
    get plan():  Int16Array              { return this._plan; }

    setRenderer (fn: RenderFn): void  { this._renderer  = fn; }
    setHistoryFn(fn: HistoryFn): void { this._historyFn = fn; }
    setPersistFn(fn: PersistFn): void { this._persistFn = fn; }
    addObserver (fn: ObserverFn): void { this._observers.push(fn); }

    commit(mutate: (s: SessionState) => void, opts?: CommitOpts): void {
        mutate(this._state);
        if (opts?.recompute !== false) this._plan = computePlan(this._state);
        if (opts?.history)             this._historyFn?.(this._state);
        if (opts?.render   !== false)  this._renderer?.(this);
        if (opts?.persist  !== false)  this._persistFn?.(this._state);
        for (const fn of this._observers) fn(this);
    }

    // Bulk replace — used for file load, undo/redo. Always recomputes plan
    // and renders. `history`/`persist` default off because the typical caller
    // (undo/redo) is itself navigating history.
    replace(state: SessionState, opts?: { history?: boolean; persist?: boolean }): void {
        this._state = state;
        this._plan  = computePlan(state);
        if (opts?.history) this._historyFn?.(state);
        this._renderer?.(this);
        if (opts?.persist) this._persistFn?.(state);
        for (const fn of this._observers) fn(this);
    }
}
