import type { SymKey } from "@mosaic/logic/types";
import { iconAction, setPressed } from "./dom";
import { MIRROR_TYPES, mirrorTypePresentation } from "./mirror-presentation";

export function createMirrorChoices(toggle: (type: SymKey) => void, idPrefix?: string) {
    const element = document.createElement("div");
    element.className = "mirror-type-choices";
    element.setAttribute("role", "group"); element.setAttribute("aria-label", "Mirror types");
    for (const type of MIRROR_TYPES) {
        const button = iconAction(`mirror-${type.key.toLowerCase()}`, type.name);
        button.dataset.mirrorType = type.key;
        if (idPrefix) button.id = `${idPrefix}-${type.key.toLowerCase()}`;
        button.addEventListener("click", () => toggle(type.key));
        element.append(button);
    }
    return { element, update(chosen: readonly SymKey[], unavailable: (type: SymKey) => string | null = () => null) {
        for (const type of mirrorTypePresentation(chosen)) {
            const button = element.querySelector<HTMLButtonElement>(`[data-mirror-type='${type.key}']`)!;
            setPressed(button, type.chosen);
            button.classList.toggle("btn--active", type.chosen || type.implied);
            const error = type.chosen ? null : unavailable(type.key);
            button.disabled = error !== null;
            const description = error ?? (type.implied ? "Implied by the chosen types. Click to choose directly."
                : type.chosen ? "Chosen directly. Click to remove this type." : "Click to choose this type.");
            if (button.getAttribute("aria-description") !== description) button.setAttribute("aria-description", description);
            const title = `${type.name}. ${description}`;
            if (button.title !== title) button.title = title;
        }
    } };
}
