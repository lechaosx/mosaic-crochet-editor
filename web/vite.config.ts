import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
    plugins: [wasm()],
    base: "./",
    build: {
        target: "esnext",
    },
    optimizeDeps: {
        exclude: ["@mosaic/wasm"],
    },
    server: {
        watch: {
            ignored: (path: string) => path.includes("node_modules") && !path.includes("@mosaic"),
        },
    },
});
