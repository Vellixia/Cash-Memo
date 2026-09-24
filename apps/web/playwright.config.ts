import { defineConfig, devices } from "@playwright/test";

/** Assumes the web app (prod build) is on :3000 and the API on :8080 — no webServer here. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Every test signs up (argon2) against one local API + DB; more workers just queue.
  workers: 4,
  expect: { timeout: 10_000 },
  retries: 0,
  // The API does a DB round-trip per call; leave headroom when many workers hit it at once.
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    locale: "en-US",
    timezoneId: "America/New_York",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, browserName: "chromium" },
    },
    // Large phone / tablet portrait: single column, but the top bar (nav switches at 768).
    {
      name: "tablet",
      use: { ...devices["iPad Pro 11"], viewport: { width: 820, height: 1180 }, browserName: "chromium" },
    },
    { name: "wide", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
