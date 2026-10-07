import type { SymKey } from "@mosaic/logic/types";
import { iconAction, setPressed } from "./dom";
import { MIRROR_TYPES, mirrorTypePresentation } from "./mirror-presentation";

export function createMirrorChoices(toggle: (type: SymKey) => void, idPrefix?: string) {
    const element = document.createElement("div");
    element.className = "mirror-type-choices";
    element.setAttribute("role", "group"); element.setAttribute("aria-label", "Mirror types");
    for (const [label, types] of [["Reflection", MIRROR_TYPES.filter(type => type.key !== "C")], ["Rotation", MIRROR_TYPES.filter(type => type.key === "C")]] as const) {
        const group = document.createElement("fieldset");
        const legend = document.createElement("legend"); legend.textContent = label;
        group.append(legend);
        const buttons = document.createElement("div"); buttons.className = "mirror-axis-buttons";
        for (const type of types) {
            const button = iconAction(`mirror-${type.key.toLowerCase()}`, type.name);
            button.dataset.mirrorType = type.key;
            if (idPrefix) button.id = `${idPrefix}-${type.key.toLowerCase()}`;
            button.addEventListener("click", () => toggle(type.key));
            buttons.append(button);
        }
        group.append(buttons); element.append(group);
    }
    return { element, update(chosen: readonly SymKey[]) {
        for (const type of mirrorTypePresentation(chosen)) {
            const button = element.querySelector<HTMLButtonElement>(`[data-mirror-type='${type.key}']`)!;
            setPressed(button, type.chosen);
            const effective = String(type.chosen || type.implied);
            if (button.dataset.effective !== effective) button.dataset.effective = effective;
            const description = type.implied ? "Implied by the chosen types. Click to choose directly."
                : type.chosen ? "Chosen directly. Click to remove this type." : "Click to choose this type.";
            if (button.getAttribute("aria-description") !== description) button.setAttribute("aria-description", description);
            const title = `${type.name}. ${description}`;
            if (button.title !== title) button.title = title;
        }
    } };
}
