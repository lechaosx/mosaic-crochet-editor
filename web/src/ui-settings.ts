import { el } from "./dom";
import type { UICallbacks, InspectorControls } from "./ui-types";

export function mountSettings(
    cb: Pick<UICallbacks, "onHighlightChange" | "onLabelsVisibleChange" | "onLockInvalidChange" | "onAbout">,
    inspector: Pick<InspectorControls, "isOpen" | "close" | "open" | "focusFirst">, drawPatternPreview: () => void) {
    /* ── Settings inspector ───────────────────────────────────────────── */
    el("btn-hl-toggle").addEventListener("click", e => {
        e.preventDefault();
        if (inspector.isOpen("settings")) inspector.close();
        else {
            inspector.open("settings", "Settings");
            inspector.focusFirst("settings");
        }
    });
    el<HTMLInputElement>("hl-opacity")        .addEventListener("input",  () => { cb.onHighlightChange(); drawPatternPreview(); });
    el<HTMLInputElement>("labels-on")   .addEventListener("change", cb.onLabelsVisibleChange);
    el<HTMLInputElement>("lock-invalid").addEventListener("change", cb.onLockInvalidChange);
    el("settings-about").addEventListener("click", () => {
        inspector.close();
        cb.onAbout();
    });


}
