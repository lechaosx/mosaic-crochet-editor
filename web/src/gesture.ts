import { ViewState, clampZoom } from "./render";

interface Pointer { x: number; y: number; button: number; type: string; }

type Mode = "idle" | "paint" | "gesture" | "gesture-end" | "middle-pan";

export interface PointerModifiers {
    shift: boolean;
    ctrl:  boolean;
    alt:   boolean;
}

export interface GestureCallbacks {
    primaryColor:  () => 1 | 2;
    onPaintStart:  (color: 1 | 2, modifiers: PointerModifiers) => void;
    onPaintAt:     (clientX: number, clientY: number) => void;
    onPaintEnd:    () => void;     // commit stroke (record history if changed)
    onPaintCancel: () => void;     // discard stroke (revert to pre-stroke pixels)
    onHover:       (x: number | null, y: number | null) => void;
    onView:        () => void;     // re-render after view change (pan/zoom)
}

// `clientToPattern` is supplied by the caller: it takes raw client coords and
// returns the pattern-space position (and whether that position is inside
// the canvas). Returns null when there's no pattern yet. The caller closes
// over whatever state is needed (current pattern, dpr, visualRotation, etc.)
// — gesture has no business knowing.
export type ClientToPattern = (clientX: number, clientY: number)
    => { x: number; y: number; inside: boolean } | null;

function zoomAt(canvas: HTMLCanvasElement, view: ViewState, clientX: number, clientY: number, factor: number) {
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width  / 2);
    const dy = clientY - (rect.top  + rect.height / 2);
    const newZoom = clampZoom(view.zoom * factor);
    const f = newZoom / view.zoom;
    view.panX = dx - f * (dx - view.panX);
    view.panY = dy - f * (dy - view.panY);
    view.zoom = newZoom;
}

export function mountGestures(
    canvas: HTMLCanvasElement, view: ViewState,
    clientToPattern: ClientToPattern, cb: GestureCallbacks,
) {
    const pointers = new Map<number, Pointer>();
    let mode: Mode = "idle";

    let gestMid = { x: 0, y: 0 };
    let gestDist = 0;
    let middlePan = { startX: 0, startY: 0, originX: 0, originY: 0 };

    function pts() { return [...pointers.values()]; }
    function midpoint() { const [a, b] = pts(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    function distance() { const [a, b] = pts(); return Math.hypot(a.x - b.x, a.y - b.y); }

    function startGesture() {
        // A second pointer means the user is starting a pan/zoom gesture, not
        // a paint — discard whatever the first pointer drew (the dot from
        // pointerdown, anything from move events) so we don't leave stray
        // marks behind.
        if (mode === "paint") cb.onPaintCancel();
        gestMid  = midpoint();
        gestDist = distance();
        mode = "gesture";
    }

    canvas.addEventListener("pointerdown", e => {
        if (e.pointerType === "mouse" && e.button === 1) {
            e.preventDefault();
            if (mode !== "idle") return;
            middlePan = { startX: e.clientX, startY: e.clientY, originX: view.panX, originY: view.panY };
            mode = "middle-pan";
            canvas.setPointerCapture(e.pointerId);
            return;
        }
        if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;

        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, type: e.pointerType });
        canvas.setPointerCapture(e.pointerId);

        if (pointers.size >= 2) {
            startGesture();
        } else if (mode === "idle") {
            const color: 1 | 2 = e.button === 2 ? (cb.primaryColor() === 1 ? 2 : 1) : cb.primaryColor();
            mode = "paint";
            cb.onPaintStart(color, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
            cb.onPaintAt(e.clientX, e.clientY);
        }
    });

    canvas.addEventListener("pointermove", e => {
        if (mode === "middle-pan") {
            view.panX = middlePan.originX + (e.clientX - middlePan.startX);
            view.panY = middlePan.originY + (e.clientY - middlePan.startY);
            cb.onView();
            return;
        }
        const p = pointers.get(e.pointerId);
        if (!p) {
            const cp = clientToPattern(e.clientX, e.clientY);
            if (!cp) { cb.onHover(null, null); return; }
            cb.onHover(cp.inside ? cp.x : null, cp.inside ? cp.y : null);
            return;
        }
        p.x = e.clientX;
        p.y = e.clientY;

        if (mode === "paint") {
            cb.onPaintAt(e.clientX, e.clientY);
        } else if (mode === "gesture") {
            const m = midpoint();
            const d = distance();
            if (gestDist > 0) {
                zoomAt(canvas, view, m.x, m.y, d / gestDist);
                view.panX += m.x - gestMid.x;
                view.panY += m.y - gestMid.y;
            }
            gestMid = m;
            gestDist = d;
            cb.onView();
        }
    });

    function release(e: PointerEvent) {
        if (mode === "middle-pan" && e.pointerType === "mouse" && e.button === 1) {
            mode = "idle";
            canvas.releasePointerCapture(e.pointerId);
            return;
        }
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        canvas.releasePointerCapture(e.pointerId);

        if (mode === "paint" && pointers.size === 0) {
            cb.onPaintEnd();
            mode = "idle";
        } else if (mode === "gesture" || mode === "gesture-end") {
            if (pointers.size === 0) {
                mode = "idle";
            } else {
                mode = "gesture-end";
            }
        }
    }

    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", e => {
        if (mode === "idle" && !pointers.has(e.pointerId)) cb.onHover(null, null);
    });
    canvas.addEventListener("contextmenu", e => e.preventDefault());

    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        zoomAt(canvas, view, e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
        cb.onView();
    }, { passive: false });
}
