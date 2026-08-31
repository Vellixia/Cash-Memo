import { defineConfig, devices } from "@playwright/test";
import { PUBLIC_ORIGIN } from "./e2e/support/environment.mjs";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // This disposable E2E stack shares one Argon2-auth Rust API and a 2-vCPU/4-GiB
  // Colima VM. Parallel browser workers starve those shared services and cause
  // unrelated flows to time out; keep local and CI runs deterministic.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 30_000 },
  outputDir: "./test-results",
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  use: {
    baseURL: PUBLIC_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/support/start-api.mjs",
      url: "http://localhost:3001/api/v1/health/ready",
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: "pnpm build && pnpm start --hostname 127.0.0.1 --port 3000",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
