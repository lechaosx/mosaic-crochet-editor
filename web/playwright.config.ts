// Runs against `vite preview`. `reuseExistingServer` lets you keep a
// dev server running during local iteration.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly:    !!process.env.CI,
    retries:       process.env.CI ? 2 : 0,
    use: {
        baseURL: "http://localhost:4173",
        trace:   "on-first-retry",
        // Headless Chromium has no WebGL2 when it inherits a desktop session's
        // WAYLAND_DISPLAY: its GPU process fails to start.
        launchOptions: {
            env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "WAYLAND_DISPLAY")),
        },
    },
    projects: [
        {
            name:       "chromium",
            testIgnore: "**/touch.spec.ts",
            use:        devices["Desktop Chrome"],
        },
        {
            name:      "mobile-chromium",
            testMatch: "**/touch.spec.ts",
            use:       devices["Pixel 7"],
        },
    ],
    webServer: {
        command: "npm run preview -- --port 4173",
        url:     "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
    },
});
