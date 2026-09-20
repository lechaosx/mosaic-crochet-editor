import { createHash } from "node:crypto";

interface ReleaseNotesEntry {
    heading: string;
    notes: string[];
}

export interface BuiltReleaseNotes {
    currentHash: string;
    html: string;
}

const MONTHS = new Map([
    ["January", 1], ["February", 2], ["March", 3], ["April", 4],
    ["May", 5], ["June", 6], ["July", 7], ["August", 8],
    ["September", 9], ["October", 10], ["November", 11], ["December", 12],
]);

function normalize(text: string): string {
    return text.trim().replace(/\s+/g, " ");
}

function parseReleaseNotes(markdown: string): ReleaseNotesEntry[] {
    const entries: ReleaseNotesEntry[] = [];
    let current: ReleaseNotesEntry | undefined;

    for (const line of markdown.split(/\r?\n/)) {
        const heading = line.match(/^##\s+(.+?)\s*$/);
        if (heading) {
            if (current) entries.push(current);
            current = { heading: normalize(heading[1]), notes: [] };
            continue;
        }

        if (!current || line.trim() === "") continue;

        const note = line.match(/^-\s+(.+?)\s*$/);
        if (note) {
            current.notes.push(normalize(note[1]));
            continue;
        }

        throw new Error(`RELEASE_NOTES.md release "${current.heading}" must use flat bullet notes`);
    }

    if (current) entries.push(current);
    if (entries.length === 0) throw new Error("RELEASE_NOTES.md has no release sections");
    for (const entry of entries) {
        if (entry.notes.length === 0) {
            throw new Error(`RELEASE_NOTES.md release "${entry.heading}" has no notes`);
        }
    }
    return entries;
}

function escapeHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function headingHtml(heading: string): string {
    const fullDate = heading.match(/^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/);
    if (fullDate) {
        const month = MONTHS.get(fullDate[2]);
        if (month) {
            const datetime = `${fullDate[3]}-${String(month).padStart(2, "0")}-${fullDate[1].padStart(2, "0")}`;
            return `<time datetime="${datetime}">${escapeHtml(heading)}</time>`;
        }
    }

    const monthDate = heading.match(/^([A-Z][a-z]+) (\d{4})$/);
    if (monthDate) {
        const month = MONTHS.get(monthDate[1]);
        if (month) {
            const datetime = `${monthDate[2]}-${String(month).padStart(2, "0")}`;
            return `<time datetime="${datetime}">${escapeHtml(heading)}</time>`;
        }
    }

    return escapeHtml(heading);
}

function renderEntry(entry: ReleaseNotesEntry): string {
    const notes = entry.notes.map(note => `              <li>${escapeHtml(note)}</li>`).join("\n");
    return `          <section class="about-release-notes-entry">
            <h3>${headingHtml(entry.heading)}</h3>
            <ul>
${notes}
            </ul>
          </section>`;
}

export function buildReleaseNotes(markdown: string): BuiltReleaseNotes {
    const entries = parseReleaseNotes(markdown);
    const latest = entries[0];
    const canonicalLatest = JSON.stringify([latest.heading, ...latest.notes]);

    return {
        currentHash: createHash("sha256").update(canonicalLatest).digest("hex"),
        html: entries.map(renderEntry).join("\n"),
    };
}
