// Vite config — also serves Vitest (the `test` block below is recognised
// by `vitest/config`'s `defineConfig`; Vite itself ignores it). Single
// config means tests resolve `@mosaic/wasm` through the same
// `vite-plugin-wasm` glue as the dev/build path.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vitest/config";
import wasm from "vite-plugin-wasm";
import { buildReleaseNotes } from "./build/release-notes";

const releaseNotesPath = fileURLToPath(new URL("../RELEASE_NOTES.md", import.meta.url));

function generatedReleaseNotes(): PluginOption {
    return {
        name: "generated-release-notes",
        configureServer(server) {
            server.watcher.add(releaseNotesPath);
        },
        handleHotUpdate({ file, server }) {
            if (file === releaseNotesPath) {
                server.ws.send({ type: "full-reload" });
                return [];
            }
        },
        async transformIndexHtml(html) {
            const built = buildReleaseNotes(await readFile(releaseNotesPath, "utf8"));
            const marker = "          <!-- release-notes:entries -->";
            if (!html.includes(marker)) throw new Error("index.html has no release-notes entry marker");

            return html
                .replace('id="about-release-notes"', `id="about-release-notes" data-current-hash="${built.currentHash}"`)
                .replace(marker, built.html);
        },
    };
}

// Force a full page reload (not HMR) whenever anything in `wasm/pkg/` changes
// in dev. `vite-plugin-wasm` hot-replaces the JS glue but the .wasm binary is
// instantiated once per tab — so a signature change in `core/`+`wasm/` leaves
// the browser holding stale exports the new JS expects. Symptom:
//   "wasm.__wbindgen_add_to_stack_pointer is not a function".
// Reloading the tab re-instantiates the wasm with bindings the glue agrees on.
function wasmFullReload(): PluginOption {
    return {
        name: "wasm-pkg-full-reload",
        handleHotUpdate({ file, server }) {
            if (file.includes("/wasm/pkg/")) {
                server.ws.send({ type: "full-reload" });
                return [];
            }
        },
    };
}

export default defineConfig({
    plugins: [wasm(), wasmFullReload(), generatedReleaseNotes()],
    base: "./",
    build: { target: "esnext" },
    optimizeDeps: { exclude: ["@mosaic/wasm"] },
    server: {
        watch: {
            ignored: (path: string) => path.includes("node_modules") && !path.includes("@mosaic"),
        },
    },
    test: {
        include: ["tests/**/*.test.ts"],
        // Tests that need DOM / localStorage opt in via a per-file
        // `// @vitest-environment jsdom` annotation at the top.
        coverage: {
            // Istanbul (not V8): Bun doesn't expose V8 coverage APIs.
            provider: "istanbul",
            include:  ["src/**/*.ts"],
            // Exclude pure DOM glue and the boot file — not unit-testable
            // here, covered by Playwright E2E.
            exclude:  ["src/main.ts", "src/ui.ts", "src/gesture.ts", "src/render.ts", "src/dom.ts"],
            reporter: ["text", "html"],
        },
    },
});
