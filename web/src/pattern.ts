// DOM adapter for the Edit popover — reads inputs and delegates to the pure
// applyEditSettings in @mosaic/logic/pattern.
import { applyEditSettings as applyEditSettingsLogic, EditSettings } from "@mosaic/logic/pattern";
import { PatternState } from "@mosaic/logic/types";
import { readClampedInt, radioValue } from "./dom";

export function applyEditSettings(
    source?: { pattern: PatternState; pixels: Uint8Array },
): { pattern: PatternState; pixels: Uint8Array } {
    const mode    = radioValue("edit-mode") as "row" | "round";
    const wipeEl  = document.getElementById("edit-wipe") as HTMLInputElement | null;
    const wipe    = wipeEl ? (wipeEl.checked || wipeEl.disabled) : false;
    let settings: EditSettings;
    if (mode === "row") {
        settings = {
            mode,
            width:  readClampedInt("edit-width",  2),
            height: readClampedInt("edit-height", 2),
            wipe,
        };
    } else {
        settings = {
            mode:        "round",
            innerWidth:  readClampedInt("edit-inner-width",  0),
            innerHeight: readClampedInt("edit-inner-height", 0),
            rounds:      readClampedInt("edit-rounds",       1),
            subMode:     radioValue("edit-submode") as "full" | "half" | "quarter",
            wipe,
        };
    }
    return applyEditSettingsLogic(settings, source);
}
