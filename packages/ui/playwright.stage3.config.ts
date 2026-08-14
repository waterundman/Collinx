import { defineConfig, devices } from "@playwright/test";

/**
 * Temporary config for v1.10.0 Stage 3 E2E runs.
 *
 * pnpm is broken on this machine (safe-delete guard), so tests are launched
 * via `node node_modules/@playwright/test/cli.js test --config=...` and the
 * dev server is already running on :5180 (reuseExistingServer, no trace) —
 * same workaround as v1.9.0 Stage 3.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://localhost:5180",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "msedge",
      use: { ...devices["Desktop Edge"], channel: "msedge" },
    },
  ],
  webServer: {
    command: "node_modules/.bin/vite --port 5180 --strictPort",
    port: 5180,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
