// Single mutable owner for editor session state. Mutations go through
// `commit(mutate, opts?)` — the only place where the recompute → render →
// history → persist → observers chain runs. Direct mutation of `store.state`
// is a bug; the type is `Readonly<SessionState>` so the compiler will flag it.
//
// Ephemeral state stays outside the Store:
//   • view pan/zoom + animation state — render.ts (perf-sensitive)
//   • stroke state (preStroke, invertVisited, strokeColor) — main.ts (per-stroke)

import { Tool, ToolVariants, PatternState, Float, MirrorCenter, GridRecipe } from "./types";
import { emptyGridRecipe, normalizeActiveRecipeId } from "./grid-recipes";
import { samePatternGeometry } from "./pattern";
import {
    changedCells, computeHighlightPlan, updateHighlightPlan,
    type CellRect, type HighlightPlan, type MutableHighlightPlan,
} from "./highlight-plan";

// Changes assign new `pattern`, `pixels` and `float` values instead of writing
// into the current ones: the plan update skips a change that keeps all three,
// finds changed cells by comparing the visible pixels with the previous ones,
// and rebuilds when `pattern` describes another geometry. A session shown
// again reuses its kept plan while it keeps all three.
export interface SessionState {
    pattern:       PatternState;
    pixels:        Uint8Array;
    colorA:        string;               // hex
    colorB:        string;               // hex
    dangerColorOverride: string | null;
    accentColorOverride: string | null;
    activeTool:    Tool;
    toolVariants:  ToolVariants;
    primaryColor:  1 | 2;
    mirrors:       MirrorCenter[];
    recipes:       GridRecipe[];         // saved selection repeat definitions
    activeRecipeId: string | null;       // source selection currently extended by a recipe
    liveMirrors:   boolean;
    // The active lifted-selection layer (on or near canvas). When present,
    // `pixels` carries the canvas with the float's cells cut to natural
    // baseline; `float.pixels` stamps back on top at render. Commit writes
    // lifted pixels back into the canvas and clears the float.
    float:         Float | null;
    rotation:      number;               // degrees (target — render.ts animates the visual)
}

export interface CommitOpts {
    render?:    boolean;   // call the registered renderer (default: true)
    history?:   boolean;   // push snapshot to undo stack  (default: false)
    persist?:   boolean;   // write to localStorage        (default: true)
}

export type RenderFn   = (store: Store) => void;
export type ObserverFn = (store: Store) => void;
export type HistoryFn  = (s: Readonly<SessionState>) => void;
export type PersistFn  = (s: Readonly<SessionState>) => void;

// Returns true when (x, y) falls outside the [0, W) × [0, H) canvas.
export function outOfBounds(x: number, y: number, W: number, H: number): boolean {
    return x < 0 || x >= W || y < 0 || y >= H;
}

// Whether (x, y) is a cell of the visible chart. A float only recolours chart
// cells, so they are where `pixels` is nonzero.
export function isChartCell(s: Readonly<SessionState>, x: number, y: number): boolean {
    const { canvasWidth: W, canvasHeight: H } = s.pattern;
    return !outOfBounds(x, y, W, H) && s.pixels[y * W + x] !== 0;
}

// Calls fn(x, y) for every cell in a W×H grid.
export function forEachCell(W: number, H: number, fn: (x: number, y: number) => void): void {
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
            fn(x, y);
}

// The visible canvas: `pixels` with `float` stamped at its absolute position.
// Off-canvas float cells and holes are skipped.
export function visiblePixels(s: Readonly<SessionState>): Uint8Array {
    if (!s.float) return s.pixels;
    const { canvasWidth: W, canvasHeight: H } = s.pattern;
    const f = s.float;
    const out = s.pixels.slice();
    for (let ly = 0; ly < f.h; ly++) {
        for (let lx = 0; lx < f.w; lx++) {
            const v = f.pixels[ly * f.w + lx];
            if (v === 0) continue;
            const cx = f.x + lx, cy = f.y + ly;
            if (outOfBounds(cx, cy, W, H)) continue;
            if (out[cy * W + cx] === 0) continue;   // hole
            out[cy * W + cx] = v;
        }
    }
    return out;
}

// What changed in the visible pixels and the plan since a reader's version:
// nothing, the cells of a rectangle, or anything.
export type PlanChange = CellRect | "all" | null;

// The plan of a session's visible pixels and what it was computed from.
interface DerivedData {
    source:  Pick<SessionState, "pattern" | "pixels" | "float">;
    visible: Uint8Array;
    plan:    MutableHighlightPlan;
    version: object;
}

export class Store {
    private _state: SessionState;
    // The plan, updated in place, and the state and visible pixels it was
    // computed from.
    private _plan!:       MutableHighlightPlan;
    private _planSource!: Pick<SessionState, "pattern" | "pixels" | "float">;
    private _visible!:    Uint8Array;
    // A new version object marks each change; `_change` is the region it
    // covers since `_previousVersion`. Both are null after a rebuild, so the
    // Store holds no version of a plan it no longer has.
    private _version:         object = {};
    private _previousVersion: object | null = null;
    private _change:          CellRect | null = null;
    // The session shown, and the derived data of others by session id, kept
    // to show them again without a rebuild. Kept data is never updated: the
    // plan is updated in place, so a session takes its data back out.
    private _session: string | null;
    private _kept = new Map<string, DerivedData>();
    private _renderer:  RenderFn  | null = null;
    private _historyFn: HistoryFn | null = null;
    private _persistFn: PersistFn | null = null;
    private _observers: ObserverFn[] = [];

    constructor(state: SessionState, session: string | null = null) {
        if (state.recipes.length === 0) state.recipes = [emptyGridRecipe()];
        state.activeRecipeId = normalizeActiveRecipeId(state.recipes, state.activeRecipeId, state.float);
        this._state = state;
        this._session = session;
        this.rebuildPlan();
    }

    get state(): Readonly<SessionState> { return this._state; }
    get plan():  HighlightPlan           { return this._plan; }
    // `visiblePixels(state)`, as the plan was last computed from it.
    get visible(): Uint8Array            { return this._visible; }
    get planVersion(): object            { return this._version; }

    planChangeSince(version: object | null): PlanChange {
        if (version === this._version) return null;
        return version === this._previousVersion && this._change ? this._change : "all";
    }

    setRenderer (fn: RenderFn): void  { this._renderer  = fn; }
    setHistoryFn(fn: HistoryFn): void { this._historyFn = fn; }
    setPersistFn(fn: PersistFn): void { this._persistFn = fn; }
    addObserver (fn: ObserverFn): void { this._observers.push(fn); }

    commit(mutate: (s: SessionState) => void, opts?: CommitOpts): void {
        mutate(this._state);
        this._state.activeRecipeId = normalizeActiveRecipeId(
            this._state.recipes, this._state.activeRecipeId, this._state.float,
        );
        this.updatePlan();
        if (opts?.history)            this._historyFn?.(this._state);
        if (opts?.render  !== false)  this._renderer?.(this);
        if (opts?.persist !== false)  this._persistFn?.(this._state);
        for (const fn of this._observers) fn(this);
    }

    // Bulk replace — used for file load, undo/redo, and with `session` for
    // showing another session. Updates the plan as `commit` does and always
    // renders. `history`/`persist` default off because the typical caller
    // (undo/redo) is itself navigating history.
    replace(state: SessionState, opts?: { history?: boolean; persist?: boolean; session?: string }): void {
        if (state.recipes.length === 0) state.recipes = [emptyGridRecipe()];
        state.activeRecipeId = normalizeActiveRecipeId(state.recipes, state.activeRecipeId, state.float);
        this._state = state;
        if (opts?.session !== undefined && opts.session !== this._session) this.switchSession(opts.session);
        else this.updatePlan();
        if (opts?.history) this._historyFn?.(state);
        this._renderer?.(this);
        if (opts?.persist) this._persistFn?.(state);
        for (const fn of this._observers) fn(this);
    }

    // Drops the derived data kept for a session that will not be shown again,
    // and stops keeping it if it is the one shown.
    forgetSession(session: string): void {
        this._kept.delete(session);
        if (session === this._session) this._session = null;
    }

    private switchSession(session: string): void {
        if (this._session !== null) {
            this._kept.set(this._session, {
                source: this._planSource, visible: this._visible, plan: this._plan, version: this._version,
            });
        }
        this._session = session;
        const kept = this._kept.get(session);
        this._kept.delete(session);
        const { pattern, pixels, float } = this._state;
        if (!kept || kept.source.pattern !== pattern || kept.source.pixels !== pixels || kept.source.float !== float) {
            return this.rebuildPlan();
        }
        this._planSource = kept.source;
        this._visible    = kept.visible;
        this._plan       = kept.plan;
        this._previousVersion = null;
        this._version         = kept.version;
        this._change          = null;
    }

    private rebuildPlan(): void {
        const { pattern, pixels, float } = this._state;
        this._planSource = { pattern, pixels, float };
        this._visible    = visiblePixels(this._state);
        this._plan       = computeHighlightPlan(pattern, this._visible);
        this.advanceVersion(null);
    }

    private updatePlan(): void {
        const { pattern, pixels, float } = this._state;
        if (!samePatternGeometry(pattern, this._planSource.pattern)) return this.rebuildPlan();
        if (pixels === this._planSource.pixels && float === this._planSource.float) return;
        this._planSource = { pattern, pixels, float };
        const visible = visiblePixels(this._state);
        const changed = changedCells(this._visible, visible, pattern.canvasWidth);
        this._visible = visible;
        if (changed) this.advanceVersion(updateHighlightPlan(this._plan, pattern, visible, changed));
    }

    private advanceVersion(change: CellRect | null): void {
        this._previousVersion = change ? this._version : null;
        this._version         = {};
        this._change          = change;
    }
}
