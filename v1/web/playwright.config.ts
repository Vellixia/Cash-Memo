import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.CASHMEMO_V1_E2E_PUBLIC_ORIGIN ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node e2e/support/start-api.mjs",
      url: "http://localhost:3001/api/v1/health/ready",
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: "pnpm dev --hostname 127.0.0.1 --port 3000",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
