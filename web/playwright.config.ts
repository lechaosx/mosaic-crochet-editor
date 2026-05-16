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
    },
    projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
    webServer: {
        command: "bun run preview -- --port 4173",
        url:     "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
    },
});
