export interface AppPreferences {
    guidanceOpacity: number;
    dangerColor:     string;
    accentColor:     string;
    labelsVisible:   boolean;
    lockInvalid:     boolean;
}

export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = {
    guidanceOpacity: 100,
    dangerColor:     "#ff7474",
    accentColor:     "#d653a3",
    labelsVisible:   true,
    lockInvalid:     true,
};

const PREFERENCES_KEY = "mosaic-preferences";
const PREFERENCES_VERSION = 1;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

interface StoredPreferences extends AppPreferences {
    version: 1;
}

function valid(value: unknown): value is StoredPreferences {
    if (typeof value !== "object" || value === null) return false;
    const data = value as Record<string, unknown>;
    return data.version === PREFERENCES_VERSION
        && typeof data.guidanceOpacity === "number"
        && Number.isInteger(data.guidanceOpacity)
        && data.guidanceOpacity >= 0
        && data.guidanceOpacity <= 100
        && typeof data.dangerColor === "string"
        && HEX_COLOR.test(data.dangerColor)
        && typeof data.accentColor === "string"
        && HEX_COLOR.test(data.accentColor)
        && typeof data.labelsVisible === "boolean"
        && typeof data.lockInvalid === "boolean";
}

export function loadAppPreferences(): AppPreferences {
    const source = localStorage.getItem(PREFERENCES_KEY);
    if (source === null) return { ...DEFAULT_APP_PREFERENCES };
    try {
        const parsed: unknown = JSON.parse(source);
        if (!valid(parsed)) throw new TypeError("Invalid preferences");
        const { version: _, ...preferences } = parsed;
        return preferences;
    } catch {
        localStorage.removeItem(PREFERENCES_KEY);
        return { ...DEFAULT_APP_PREFERENCES };
    }
}

export function saveAppPreferences(preferences: Readonly<AppPreferences>): boolean {
    const stored: StoredPreferences = { version: PREFERENCES_VERSION, ...preferences };
    if (!valid(stored)) return false;
    try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(stored));
        return true;
    } catch {
        return false;
    }
}

export function hasStoredAppPreferences(): boolean {
    return localStorage.getItem(PREFERENCES_KEY) !== null;
}
