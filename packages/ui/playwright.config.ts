import { defineConfig, devices } from "@playwright/test";

/**
 * v2.9.1：CI 用 Chromium（Linux runner 没有 Edge channel），
 * 本机用系统 Edge（无需额外下载浏览器）。
 */
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: !isCI,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? "list" : "html",
  use: {
    baseURL: "http://localhost:5180",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: isCI
    ? [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
    : [{ name: "msedge", use: { ...devices["Desktop Edge"], channel: "msedge" } }],
  webServer: {
    command: "pnpm dev",
    port: 5180,
    reuseExistingServer: !isCI,
    timeout: 60000,
  },
});
