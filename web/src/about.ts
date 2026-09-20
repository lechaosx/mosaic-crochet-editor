export const LATEST_CHANGELOG_ID = "2026-09-20-crochet-row-details";
export const LATEST_CHANGELOG_DATE = "20 September 2026";

const ABOUT_CHANGELOG_KEY = "mosaic-about-changelog";

export function shouldShowAbout(): boolean {
    try {
        return localStorage.getItem(ABOUT_CHANGELOG_KEY) !== LATEST_CHANGELOG_ID;
    } catch {
        return true;
    }
}

export function markAboutSeen(): void {
    try {
        localStorage.setItem(ABOUT_CHANGELOG_KEY, LATEST_CHANGELOG_ID);
    } catch {
        // The dialog remains usable when browser storage is unavailable.
    }
}

export function copyrightNotice(year: number): string {
    return `© ${year} Drahomír Dlabaja`;
}
