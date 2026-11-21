// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from "vitest";
import { mountInstructions } from "../src/ui-instructions";
import { packInstructionCoordinates } from "../src/instruction-coordinates";
import type { InstructionOverviewUnit } from "../src/ui-types";

const units: InstructionOverviewUnit[] = [1, 2].map(number => ({
    label: `Row ${number}`, yarn: number === 1 ? "A" : "B", color: "#000000",
    text: `Row ${number}: sc × 3`, invalid: false,
    guidanceCoords: packInstructionCoordinates([0, 2 - number], 3), seam: null,
}));

beforeEach(() => {
    document.body.innerHTML = `<canvas id="canvas"></canvas>
        <aside id="instructions-workspace" tabindex="-1"><ol id="instructions-units"></ol></aside>
        <input id="alternate" type="checkbox"><div><button id="view-design"></button><button id="view-crochet"></button></div>
        <button id="export-copy"></button><button id="instructions-live-back"></button>
        <button id="instructions-live-forward"></button>`
        + ["export-progress", "instructions-live-unavailable", "instructions-live-progress",
            "instructions-live-save-warning", "instructions-current", "instructions-current-text",
            "export-action-status"].map(id => `<div id="${id}"></div>`).join("");
    HTMLElement.prototype.scrollIntoView = vi.fn();
});

function open(plan: readonly (InstructionOverviewUnit | undefined)[] = units, completed = 0, busy = false) {
    const mounted = mountInstructions({ onInstructions: vi.fn() }, document.getElementById("canvas")!,
        vi.fn(), vi.fn(), vi.fn());
    const view = mounted.openInstructions();
    const save = vi.fn(() => true);
    const preview = vi.fn();
    view.onLivePreview(preview);
    view.setBusy(busy);
    for (const unit of plan) {
        if (!unit) break;
        view.appendUnit(unit);
    }
    view.setLivePlan(plan, "row", completed, save);
    return { view, save, preview };
}

const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const whole = () => document.querySelector<HTMLButtonElement>('[aria-label="Pattern overview"]')!;

test("Pattern overview wraps in both directions without saving synthetic progress", () => {
    const { save, preview } = open();
    expect(whole()).not.toBeNull();
    button("instructions-live-back").click();
    expect(whole().getAttribute("aria-current")).toBe("step");
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(save).not.toHaveBeenCalled();
    button("instructions-live-back").click();
    expect(save).toHaveBeenLastCalledWith(1);
    button("instructions-live-forward").click();
    expect(save).toHaveBeenCalledTimes(1);
    button("instructions-live-forward").click();
    expect(save).toHaveBeenLastCalledWith(0);
    expect(preview).toHaveBeenLastCalledWith(1);
});

test("Whole remains selected and focused while the real plan is replaced", () => {
    const { view, save } = open();
    expect(whole()).not.toBeNull();
    whole().click();
    whole().focus();
    const original = whole();
    view.clearUnits();
    units.forEach(view.appendUnit);
    view.setLivePlan(units, "row", 0, save);
    expect(whole()).toBe(original);
    expect(document.activeElement).toBe(original);
    expect(whole().getAttribute("aria-current")).toBe("step");
    expect(save).not.toHaveBeenCalled();
});

test("empty and busy plans disable navigation and expose no Whole entry", () => {
    const { view } = open([]);
    expect(whole()).toBeNull();
    expect(button("instructions-live-back").disabled).toBe(true);
    expect(button("instructions-live-forward").disabled).toBe(true);
    view.setBusy(true);
    units.forEach(view.appendUnit);
    expect(whole()).toBeNull();
    expect(document.getElementById("instructions-current")!.hidden).toBe(true);
});

test("Whole stays after newly generated real units without losing focus", () => {
    const { view, save } = open(units.slice(0, 1));
    button("instructions-live-forward").click();
    expect(whole().getAttribute("aria-current")).toBe("step");
    button("instructions-live-forward").click();
    expect(document.querySelector('[aria-label="Row 1, Yarn A"]')!.getAttribute("aria-current")).toBe("step");
    button("instructions-live-back").click();
    expect(whole().getAttribute("aria-current")).toBe("step");
    button("instructions-live-back").click();
    expect(save).toHaveBeenLastCalledWith(0);
    whole().click();
    whole().focus();
    const original = whole();
    view.clearUnits();
    units.forEach(view.appendUnit);
    view.setLivePlan(units, "row", 0, save);
    const displayed = Array.from(document.querySelectorAll(".instructions-unit"));
    expect(displayed.map(item => item.getAttribute("aria-label"))).toEqual([
        "Row 1, Yarn A", "Row 2, Yarn B", "Pattern overview",
    ]);
    expect(document.activeElement).toBe(original);
});

test("existing completed-total records select the last real unit, with Whole next", () => {
    const { save, preview } = open(units, units.length);
    expect(document.querySelector('[aria-label="Row 2, Yarn B"]')!.getAttribute("aria-current")).toBe("step");
    expect(preview).toHaveBeenLastCalledWith(2);
    expect(button("instructions-live-forward").disabled).toBe(false);
    button("instructions-live-forward").click();
    expect(whole().getAttribute("aria-current")).toBe("step");
    expect(save).not.toHaveBeenCalled();
});

test("a pending unit can be selected and shows its instruction once generated", () => {
    const { view, save, preview } = open([units[0], undefined], 0, true);
    const forward = button("instructions-live-forward");
    expect(forward.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Row 1, Yarn A"]')!.disabled).toBe(false);
    expect(preview).toHaveBeenLastCalledWith(1);
    forward.click();
    expect(save).toHaveBeenLastCalledWith(1);
    expect(document.getElementById("instructions-live-progress")!.textContent).toBe("2 / 2");
    expect(document.getElementById("instructions-current")!.hidden).toBe(false);
    expect(document.getElementById("instructions-current-text")!.textContent).toBe("Generating…");
    expect(preview).toHaveBeenCalledTimes(1);
    view.setUnit(1, units[1]);
    expect(document.getElementById("instructions-current-text")!.textContent).toBe("sc\u00a0×\u00a03");
    expect(preview).toHaveBeenLastCalledWith(2);
});

test("units listed after the selection was made show whether they are complete or current", () => {
    const { view } = open([undefined, undefined], 1, true);
    view.appendUnit(units[0]);
    view.appendUnit(units[1]);
    const [first, second] = document.querySelectorAll(".instructions-unit");
    expect(first.classList.contains("instructions-unit--complete")).toBe(true);
    expect(second.getAttribute("aria-current")).toBe("step");
});

test("rounds are navigated by round before any is generated", () => {
    const mounted = mountInstructions({ onInstructions: vi.fn() }, document.getElementById("canvas")!,
        vi.fn(), vi.fn(), vi.fn());
    const view = mounted.openInstructions();
    view.setLivePlan([undefined], "round", 0, vi.fn(() => true));
    expect(button("instructions-live-forward").getAttribute("aria-label")).toBe("Forward one round");
});

test("Pattern overview is marked invalid once the whole plan is known, without previewing again", () => {
    const { view, preview } = open(units, 0, true);
    whole().click();
    preview.mockClear();
    view.setWholeInvalid(true);
    const marked = document.querySelector<HTMLButtonElement>('[aria-label="Pattern overview, contains invalid placements"]')!;
    expect(marked.classList.contains("instructions-unit--current-invalid")).toBe(true);
    expect(preview).not.toHaveBeenCalled();
});

test("a failed generation says so and leaves no pending unit generating", () => {
    const { view } = open([units[0], undefined], 1, true);
    view.setFailed();
    expect(document.getElementById("instructions-live-unavailable")!.hidden).toBe(false);
    expect(document.getElementById("instructions-live-unavailable")!.textContent)
        .toBe("Instructions could not be generated. Reload the page to try again.");
    expect(document.getElementById("instructions-current-text")!.textContent).toBe("Not generated");
    button("instructions-live-back").click();
    expect(document.getElementById("instructions-current-text")!.textContent).toBe("sc × 3");
});
