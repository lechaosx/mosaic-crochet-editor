import { el } from "./dom";
import type { UICallbacks } from "./ui-types";

// Settings apply to every pattern, so they drop from the app bar over the
// workspace and leave the pattern's own panel open. The popover is manual:
// an automatic one closes on the pointerdown that its own button's click
// would then reopen, and returns focus to a Menu item that has closed.
export function mountSettings(
    cb: Pick<UICallbacks, "onHighlightChange" | "onLabelsVisibleChange" | "onLockInvalidChange" | "onAbout">,
    drawPatternPreview: () => void) {
    const popover = el("hl-popover");
    const trigger = el<HTMLButtonElement>("btn-hl-toggle");
    const menu = el<HTMLButtonElement>("btn-more");
    const isOpen = () => popover.matches(":popover-open");
    // Compact layouts move Settings into Menu, which closes as Settings opens.
    const anchor = () => trigger.closest("#more-popover") ? menu : trigger;

    function place() {
        const { bottom, right } = anchor().getBoundingClientRect();
        popover.style.top = `${bottom + 4}px`;
        popover.style.right = `${Math.max(4, window.innerWidth - right)}px`;
    }

    function close(restoreFocus: boolean) {
        popover.hidePopover();
        if (restoreFocus) anchor().focus();
    }

    trigger.addEventListener("click", e => {
        e.preventDefault();
        if (isOpen()) close(false);
        else {
            popover.showPopover();
            place();
            el("hl-opacity").focus();
        }
    });
    popover.addEventListener("toggle", e => {
        trigger.setAttribute("aria-expanded", String((e as ToggleEvent).newState === "open"));
    });
    document.addEventListener("keydown", e => {
        if (e.key !== "Escape" || !isOpen() || document.querySelector("dialog:modal, :popover-open:not(#hl-popover)")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        close(popover.contains(document.activeElement));
    }, true);
    popover.addEventListener("focusout", e => {
        const next = e.relatedTarget as Node | null;
        if (isOpen() && next && !popover.contains(next) && !trigger.contains(next)) close(false);
    });
    document.addEventListener("pointerdown", e => {
        const target = e.target as Node;
        if (!isOpen() || popover.contains(target) || trigger.contains(target)) return;
        close(false);
    }, true);
    window.addEventListener("resize", () => { if (isOpen()) place(); });

    el<HTMLInputElement>("hl-opacity")  .addEventListener("input",  () => { cb.onHighlightChange(); drawPatternPreview(); });
    el<HTMLInputElement>("labels-on")   .addEventListener("change", cb.onLabelsVisibleChange);
    el<HTMLInputElement>("lock-invalid").addEventListener("change", cb.onLockInvalidChange);
    // About returns focus to the element focused as it opens.
    el("settings-about").addEventListener("click", () => {
        close(true);
        cb.onAbout();
    });
}
