import { el } from "./dom";
import type { UICallbacks, ProjectTab, InspectorControls } from "./ui-types";

type CloseAnswer = "save" | "discard" | "cancel";

// The open projects as a WAI-ARIA tablist with automatic activation. Each
// tab's close button sits beside the tablist, ordered after its tab. Without
// an open project, the workspace offers ways to start one in place of the
// editor, and the commands that act on a pattern are unavailable.
export function mountTabs(cb: Pick<UICallbacks, "onTabSelect" | "onTabClose" | "onTabNew">,
    inspector: Pick<InspectorControls, "isOpen" | "close">) {
    const tablist = el("project-tablist");
    const closes = el("project-tab-closes");
    const workspace = el("workspace");
    const editor = [el("authoring-dock"), workspace.querySelector<HTMLElement>(".canvas-area")!];
    const empty = el("empty-workspace");
    const patternCommands = ["btn-edit", "btn-save", "btn-export"].map(id => el<HTMLButtonElement>(id));
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

    // A tab's buttons stay in place while it is open: committing a pending
    // edit on pointerdown updates the tabs, and a replaced button loses the click.
    function setTabs(tabs: readonly ProjectTab[], active: string | null) {
        const focused = document.activeElement instanceof HTMLElement
            && (tablist.contains(document.activeElement) || closes.contains(document.activeElement))
            ? document.activeElement : null;
        for (const button of [...tablist.children, ...closes.children] as HTMLElement[]) {
            if (!tabs.some(({ id }) => id === button.dataset.project)) button.remove();
        }
        tabs.forEach(({ id, title, unsaved }, i) => {
            let tab = document.getElementById(`project-tab-${id}`) as HTMLButtonElement | null;
            if (!tab) {
                tab = document.createElement("button");
                tab.type = "button";
                tab.className = "project-tab-select";
                tab.id = `project-tab-${id}`;
                tab.dataset.project = id;
                tab.setAttribute("role", "tab");
                tab.setAttribute("aria-controls", "workspace");
                tab.append(document.createElement("span"));
                tab.addEventListener("click", () => cb.onTabSelect(id));
                const close = document.createElement("button");
                close.type = "button";
                close.className = "project-tab-close";
                close.dataset.project = id;
                close.innerHTML = '<svg class="tool-icon" aria-hidden="true"><use href="#icon-close"/></svg>';
                close.addEventListener("click", () => cb.onTabClose(id));
                tablist.append(tab);
                closes.append(close);
            }
            tab.style.order = String(2 * i);
            tab.setAttribute("aria-selected", String(id === active));
            tab.tabIndex = id === active ? 0 : -1;
            tab.title = title;
            tab.firstElementChild!.textContent = title;
            const marker = tab.querySelector(".project-tab-unsaved");
            if (unsaved && !marker) tab.insertAdjacentHTML("beforeend", '<span class="project-tab-unsaved" aria-hidden="true">●</span>');
            if (!unsaved) marker?.remove();
            if (unsaved) tab.setAttribute("aria-label", `${title}, unsaved changes`);
            else tab.removeAttribute("aria-label");
            const close = closes.querySelector<HTMLElement>(`[data-project="${id}"]`)!;
            close.style.order = String(2 * i + 1);
            close.toggleAttribute("data-selected", id === active);
            close.tabIndex = id === active ? 0 : -1;
            close.setAttribute("aria-label", `Close ${title}`);
            close.title = `Close ${title}`;
        });
        for (const region of editor) region.hidden = active === null;
        empty.hidden = active !== null;
        for (const command of patternCommands) command.disabled = active === null;
        if (active === null) {
            if (!inspector.isOpen("settings")) inspector.close(false);
            workspace.removeAttribute("aria-labelledby");
            if (focused) el("tab-new").focus();
            return;
        }
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
