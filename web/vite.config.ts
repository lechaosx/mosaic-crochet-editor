// Vite config — also serves Vitest (the `test` block below is recognised
// by `vitest/config`'s `defineConfig`; Vite itself ignores it). Single
// config means tests resolve `@mosaic/wasm` through the same
// `vite-plugin-wasm` glue as the dev/build path.
import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";

export default defineConfig(({ command }) => ({
    resolve: command !== "build" ? { conditions: ["debug"] } : {},
    plugins: [wasm()],
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
}));
