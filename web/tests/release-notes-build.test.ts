import { describe, expect, test } from "vitest";
import { buildReleaseNotes } from "../build/release-notes";

const releaseNotes = `# Release notes

Introductory text.

## Current update

- First change.
- Second change.

## Older update

- Older change.
`;

describe("release notes build", () => {
    test("renders entries and hashes only the newest entry", () => {
        const built = buildReleaseNotes(releaseNotes);
        const withEditedHistory = buildReleaseNotes(releaseNotes.replace("Older change.", "Corrected older change."));
        const withEditedLatest = buildReleaseNotes(releaseNotes.replace("Second change.", "Revised second change."));

        expect(built.html).toContain("<h3>Current update</h3>");
        expect(built.html).toContain("<li>First change.</li>");
        expect(built.html).toContain("<h3>Older update</h3>");
        expect(built.currentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(withEditedHistory.currentHash).toBe(built.currentHash);
        expect(withEditedLatest.currentHash).not.toBe(built.currentHash);
    });

    test("normalizes Markdown whitespace before hashing", () => {
        const spaced = releaseNotes
            .replace("## Current update", "##   Current update  ")
            .replace("- First change.", "-   First change.  ");

        expect(buildReleaseNotes(spaced).currentHash).toBe(buildReleaseNotes(releaseNotes).currentHash);
    });

    test("renders dated headings as machine-readable times", () => {
        const built = buildReleaseNotes(`## 20 September 2026\n\n- A change.\n\n## May 2026\n\n- Initial version.\n`);

        expect(built.html).toContain('<time datetime="2026-09-20">20 September 2026</time>');
        expect(built.html).toContain('<time datetime="2026-05">May 2026</time>');
    });

    test("escapes release-note content before inserting it into HTML", () => {
        const built = buildReleaseNotes("## <Current> & update\n\n- Fixed <canvas> & controls.\n");

        expect(built.html).toContain("<h3>&lt;Current&gt; &amp; update</h3>");
        expect(built.html).toContain("<li>Fixed &lt;canvas&gt; &amp; controls.</li>");
    });

    test("rejects release notes without a release containing notes", () => {
        expect(() => buildReleaseNotes("# Release notes\n")).toThrow("no release sections");
        expect(() => buildReleaseNotes("## Empty release\n")).toThrow("has no notes");
    });

    test("rejects unsupported content inside a release", () => {
        expect(() => buildReleaseNotes("## Current release\n\nA paragraph.\n\n- A note.\n"))
            .toThrow("must use flat bullet notes");
        expect(() => buildReleaseNotes("## Current release\n\n  - A nested note.\n"))
            .toThrow("must use flat bullet notes");
    });
});
