import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";

export default defineConfig({
    root: import.meta.dirname,
    plugins: [wasm()],
    optimizeDeps: { exclude: ["@mosaic/wasm"] },
    test: {
        include: ["tests/**/*.test.ts"],
    },
});
