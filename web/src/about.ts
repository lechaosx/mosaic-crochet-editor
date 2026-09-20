const ABOUT_RELEASE_NOTES_KEY = "mosaic-about-release-notes";

export function shouldShowAbout(currentReleaseHash: string): boolean {
    try {
        return localStorage.getItem(ABOUT_RELEASE_NOTES_KEY) !== currentReleaseHash;
    } catch {
        return true;
    }
}

export function markAboutSeen(currentReleaseHash: string): void {
    try {
        localStorage.setItem(ABOUT_RELEASE_NOTES_KEY, currentReleaseHash);
    } catch {
        // The dialog remains usable when browser storage is unavailable.
    }
}

export function copyrightNotice(year: number): string {
    return `© ${year} Drahomír Dlabaja`;
}
