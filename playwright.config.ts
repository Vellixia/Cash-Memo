import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  testDir: "./tests/acceptance",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "corepack pnpm --filter @cashmemo/server run dev",
      port: 3000,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "corepack pnpm --filter @cashmemo/web run dev",
      port: 5173,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
