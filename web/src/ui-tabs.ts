import { el } from "./dom";
import type { UICallbacks, ProjectTab } from "./ui-types";

type CloseAnswer = "save" | "discard" | "cancel";

// The open projects as a WAI-ARIA tablist with automatic activation. Each
// tab's close button sits beside the tablist, ordered after its tab.
export function mountTabs(cb: Pick<UICallbacks, "onTabSelect" | "onTabClose" | "onTabNew">) {
    const tablist = el("project-tablist");
    const closes = el("project-tab-closes");
    const workspace = el("workspace");
    const closePrompt = el<HTMLDialogElement>("close-tab-prompt");
    let answer: ((value: CloseAnswer) => void) | null = null;

    el("tab-new").addEventListener("click", cb.onTabNew);

    tablist.addEventListener("keydown", event => {
        const tabs = Array.from(tablist.querySelectorAll<HTMLElement>("[role=tab]"));
        const index = tabs.indexOf(event.target as HTMLElement);
        if (index < 0) return;
        const target = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
            : event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length]
            : event.key === "Home" ? tabs[0]
            : event.key === "End" ? tabs[tabs.length - 1]
            : null;
        if (!target) return;
        event.preventDefault();
        cb.onTabSelect(target.dataset.project!);
        el(target.id).focus();
    });

    closePrompt.addEventListener("close", () => {
        const value = closePrompt.returnValue;
        answer?.(value === "save" || value === "discard" ? value : "cancel");
        answer = null;
    });

    function setTabs(tabs: readonly ProjectTab[], active: string) {
        const focused = document.activeElement instanceof HTMLElement
            && (tablist.contains(document.activeElement) || closes.contains(document.activeElement))
            ? document.activeElement : null;
        tablist.replaceChildren(...tabs.map(({ id, title, unsaved }, i) => {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "project-tab-select";
            tab.id = `project-tab-${id}`;
            tab.dataset.project = id;
            tab.style.order = String(2 * i);
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-selected", String(id === active));
            tab.setAttribute("aria-controls", "workspace");
            tab.tabIndex = id === active ? 0 : -1;
            tab.title = title;
            const name = document.createElement("span");
            name.textContent = title;
            tab.append(name);
            if (unsaved) {
                const marker = document.createElement("span");
                marker.className = "project-tab-unsaved";
                marker.setAttribute("aria-hidden", "true");
                marker.textContent = "●";
                tab.append(marker);
                tab.setAttribute("aria-label", `${title}, unsaved changes`);
            }
            tab.addEventListener("click", () => cb.onTabSelect(id));
            return tab;
        }));
        closes.replaceChildren(...(tabs.length > 1 ? tabs : []).map(({ id, title }, i) => {
            const close = document.createElement("button");
            close.type = "button";
            close.className = "project-tab-close";
            close.dataset.project = id;
            close.style.order = String(2 * i + 1);
            close.toggleAttribute("data-selected", id === active);
            close.tabIndex = id === active ? 0 : -1;
            close.setAttribute("aria-label", `Close ${title}`);
            close.title = `Close ${title}`;
            close.innerHTML = '<svg class="tool-icon" aria-hidden="true"><use href="#icon-close"/></svg>';
            close.addEventListener("click", () => cb.onTabClose(id));
            return close;
        }));
        workspace.setAttribute("aria-labelledby", `project-tab-${active}`);
        const selected = el(`project-tab-${active}`);
        selected.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (focused) {
            const group = focused.getAttribute("role") === "tab" ? tablist : closes;
            (group.querySelector<HTMLElement>(`[data-project="${focused.dataset.project}"]`) ?? selected).focus();
        }
    }

    function confirmClose(title: string): Promise<CloseAnswer> {
        el("close-tab-title").textContent = `Save changes to “${title}”?`;
        closePrompt.returnValue = "";
        closePrompt.showModal();
        return new Promise(resolve => { answer = resolve; });
    }

    return { setTabs, confirmClose };
}
