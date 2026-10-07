import { icon, setPressed } from "./dom";

interface Variant<T extends string> { value: T; label: string; icon: string; }

export function mountToolGroup<T extends string>(button: HTMLButtonElement, family: string,
    variants: readonly Variant<T>[], choose: (value: T) => void) {
    const group = document.createElement("div");
    const acceleratorHint = button.title;
    group.className = "tool-group";
    button.before(group);
    const indicator = document.createElement("span");
    indicator.className = "tool-group-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.append(icon("chevron"));
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.id = `${button.id}-variants`;
    menu.className = "tool-variant-menu";
    menu.setAttribute("popover", "manual");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `${family} variants`);
    button.setAttribute("aria-controls", [button.getAttribute("aria-controls"), menu.id].filter(Boolean).join(" "));
    group.append(button, indicator);
    document.body.append(menu);
    let chosen: T | null = null;
    let displayed: T | null = null;
    let returnFocus: HTMLElement = button;
    const items = variants.map(variant => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "btn tool-variant-item";
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-label", variant.label);
        item.tabIndex = -1;
        item.append(icon(variant.icon), document.createTextNode(variant.label));
        item.addEventListener("click", () => {
            choose(variant.value);
            menu.hidePopover();
            button.focus();
        });
        menu.append(item);
        return item;
    });

    function renderVariant(value: T) {
        const variant = variants.find(item => item.value === value)!;
        button.querySelector("use")!.setAttribute("href", `#icon-${variant.icon}`);
        button.setAttribute("aria-description", `${family} · ${variant.label}. Hold, double press, or press Arrow Down for variants.`);
        button.title = `${family} · ${variant.label} · hold or double press for variants. ${acceleratorHint}`;
        if (family === "Overlay") button.setAttribute("aria-label", `${variant.label === "Place" ? "Place" : variant.label === "Clear" ? "Clear" : "Invert"} overlay`);
    }
    function setVariant(value: T) {
        if (chosen === value) return;
        chosen = value;
        button.dataset.variant = value;
        renderVariant(displayed ?? value);
        items.forEach((item, index) => {
            item.setAttribute("aria-checked", String(variants[index].value === value));
            setPressed(item, variants[index].value === value);
            item.removeAttribute("aria-pressed");
        });
    }
    function setDisplayedVariant(value: T | null) {
        if (displayed === value) return;
        displayed = value;
        renderVariant(value ?? chosen!);
    }
    function open(from: HTMLElement) {
        returnFocus = from;
        const bounds = group.getBoundingClientRect();
        menu.showPopover();
        const menuBounds = menu.getBoundingClientRect();
        const sideDock = matchMedia("(min-width: 64rem)").matches;
        const left = sideDock ? bounds.right + 4 : bounds.left;
        const top = sideDock ? bounds.top : bounds.top - menuBounds.height - 4;
        menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - menuBounds.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - menuBounds.height - 8))}px`;
        items[variants.findIndex(variant => variant.value === chosen)].focus();
    }
    menu.addEventListener("toggle", event => {
        button.setAttribute("aria-expanded", String((event as ToggleEvent).newState === "open"));
    });
    button.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp"
            || event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            open(button);
        }
    });
    menu.addEventListener("keydown", event => {
        if (event.key === "Tab") menu.hidePopover();
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
            items[next].focus();
        }
    });
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || !menu.matches(":popover-open") || document.querySelector("dialog:modal")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        menu.hidePopover();
        returnFocus.focus();
    }, true);
    document.addEventListener("pointerdown", event => {
        const target = event.target as Node;
        if (menu.matches(":popover-open") && !menu.contains(target) && !group.contains(target)) menu.hidePopover();
    });
    document.addEventListener("focusin", event => {
        const target = event.target as Node;
        if (menu.matches(":popover-open") && !menu.contains(target) && !group.contains(target)) menu.hidePopover();
    });

    let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let heldPointer: number | null = null;
    let suppressedPointer: number | null = null;
    let lastTouchPress = 0;
    function cancelPress() {
        if (press) clearTimeout(press.timer);
        press = null;
    }
    button.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        cancelPress();
        press = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
            suppressedPointer = press!.id;
            heldPointer = press!.id;
            cancelPress();
            open(button);
        }, 450) };
    });
    button.addEventListener("pointermove", event => {
        if (!press || press.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
            suppressedPointer = press.id;
            cancelPress();
        }
    });
    document.addEventListener("pointerup", event => {
        if (press?.id === event.pointerId) cancelPress();
        if (heldPointer === event.pointerId) heldPointer = null;
    });
    for (const event of ["pointercancel", "lostpointercapture"] as const) button.addEventListener(event, pointer => {
        if (event === "pointercancel") lastTouchPress = 0;
        if (press?.id !== pointer.pointerId && heldPointer !== pointer.pointerId) return;
        lastTouchPress = 0;
        suppressedPointer = pointer.pointerId;
        cancelPress();
        if (heldPointer === pointer.pointerId) {
            heldPointer = null;
            menu.hidePopover();
        }
    });
    button.addEventListener("pointerleave", cancelPress);
    document.addEventListener("pointerdown", event => {
        suppressedPointer = null;
        if (!group.contains(event.target as Node)) lastTouchPress = 0;
    }, true);
    document.addEventListener("click", event => {
        if (event.detail !== 0 && suppressedPointer === (event as PointerEvent).pointerId) {
            event.preventDefault();
            event.stopImmediatePropagation();
            suppressedPointer = null;
        }
    }, true);
    button.addEventListener("click", event => {
        const touch = (event as PointerEvent).pointerType === "touch";
        const doubleTouch = touch && lastTouchPress > 0 && event.timeStamp - lastTouchPress < 350;
        lastTouchPress = touch && !doubleTouch ? event.timeStamp : 0;
        if (!touch && event.detail === 2 || doubleTouch) open(button);
        else choose(chosen!);
    });
    window.addEventListener("blur", () => {
        lastTouchPress = 0;
        if (press) suppressedPointer = press.id;
        cancelPress();
        heldPointer = null;
        if (menu.matches(":popover-open")) menu.hidePopover();
    });
    window.addEventListener("scroll", event => {
        if (event.target instanceof Node && menu.contains(event.target)) return;
        lastTouchPress = 0;
        if (press) suppressedPointer = press.id;
        cancelPress();
        if (menu.matches(":popover-open")) menu.hidePopover();
    }, true);
    window.addEventListener("resize", () => {
        if (menu.matches(":popover-open")) menu.hidePopover();
    });
    setVariant(variants[0].value);
    return { setVariant, setDisplayedVariant };
}
