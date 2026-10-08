import { ViewState, zoomAt } from "./render";

interface Pointer { x: number; y: number; button: number; type: string; }

type Mode = "idle" | "paint" | "gesture" | "gesture-end" | "navigate-pan";

export interface PointerModifiers {
    shift: boolean;
    ctrl:  boolean;
    alt:   boolean;
}

export interface GestureCallbacks {
    onPaintStart:  (button: 0 | 2, modifiers: PointerModifiers, clientX: number, clientY: number) => void;
    onPaintAt:     (clientX: number, clientY: number) => void;
    onPaintEnd:    () => void;     // commit stroke (record history if changed)
    onPaintCancel: () => void;     // discard stroke (revert to pre-stroke pixels)
    onHover:       (x: number | null, y: number | null, clientX: number | null, clientY: number | null) => void;
    onView:        () => void;     // re-render after view change (pan/zoom)
    navigate:      () => boolean;
}

// `clientToPattern` is supplied by the caller: it takes raw client coords and
// returns the pattern-space position (and whether that position is inside
// the canvas). Returns null when there's no pattern yet. The caller closes
// over whatever state is needed (current pattern, dpr, visualRotation, etc.)
// — gesture has no business knowing.
export type ClientToPattern = (clientX: number, clientY: number)
    => { x: number; y: number; inside: boolean } | null;

export function mountGestures(
    canvas: HTMLCanvasElement, view: ViewState,
    clientToPattern: ClientToPattern, cb: GestureCallbacks,
) {
    const pointers = new Map<number, Pointer>();
    let mode: Mode = "idle";

    let gestMid = { x: 0, y: 0 };
    let gestDist = 0;
    let pan = { pointerId: -1, startX: 0, startY: 0, originX: 0, originY: 0 };

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
        if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
        if (e.button === 1 || e.button === 2) e.preventDefault();
        if (cb.navigate() && e.button === 2) return;
        if (e.button === 1 || cb.navigate() && e.button === 0) {
            e.preventDefault();
            if (mode !== "idle") return;
            pan = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
                originX: view.panX, originY: view.panY };
            mode = "navigate-pan";
            canvas.setPointerCapture(e.pointerId);
            return;
        }

        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, type: e.pointerType });
        canvas.setPointerCapture(e.pointerId);

        if (pointers.size >= 2) {
            startGesture();
        } else if (mode === "idle") {
            mode = "paint";
            cb.onPaintStart(e.button, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey }, e.clientX, e.clientY);
            cb.onPaintAt(e.clientX, e.clientY);
        }
    });

    canvas.addEventListener("pointermove", e => {
        if (mode === "navigate-pan" && e.pointerId === pan.pointerId) {
            view.panX = pan.originX + (e.clientX - pan.startX);
            view.panY = pan.originY + (e.clientY - pan.startY);
            cb.onView();
            return;
        }
        const p = pointers.get(e.pointerId);
        if (!p) {
            if (e.pointerType === "touch") return;
            const cp = clientToPattern(e.clientX, e.clientY);
            if (!cp) { cb.onHover(null, null, null, null); return; }
            cb.onHover(cp.inside ? cp.x : null, cp.inside ? cp.y : null, e.clientX, e.clientY);
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
        if (mode === "navigate-pan" && e.pointerId === pan.pointerId) {
            mode = "idle";
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
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

    function cancel(e: PointerEvent) {
        if (mode === "navigate-pan" && e.pointerId === pan.pointerId) {
            mode = "idle";
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
            return;
        }
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

        if (mode === "paint") {
            cb.onPaintCancel();
            mode = "idle";
        } else if (mode === "gesture" || mode === "gesture-end") {
            mode = pointers.size === 0 ? "idle" : "gesture-end";
        }
    }

    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("lostpointercapture", cancel);
    function cancelAll(): boolean {
        if (mode === "idle") return false;
        const painting = mode === "paint";
        mode = "idle";
        const captured = [...pointers.keys(), pan.pointerId];
        pointers.clear();
        for (const pointerId of captured) {
            if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
        }
        if (painting) cb.onPaintCancel();
        cb.onHover(null, null, null, null);
        return true;
    }
    window.addEventListener("blur", cancelAll);
    canvas.addEventListener("pointerleave", e => {
        if (mode === "idle" && !pointers.has(e.pointerId)) cb.onHover(null, null, null, null);
    });
    canvas.addEventListener("contextmenu", e => e.preventDefault());

    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        zoomAt(canvas, view, e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
        cb.onView();
    }, { passive: false });
    function finish(): boolean {
        if (mode !== "paint") return false;
        mode = "idle";
        const captured = [...pointers.keys()];
        pointers.clear();
        for (const pointerId of captured) {
            if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
        }
        cb.onPaintEnd();
        cb.onHover(null, null, null, null);
        return true;
    }
    return { cancel: cancelAll, finish };
}
