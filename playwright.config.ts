import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/acceptance",
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command:
      "npm run dev --workspace @cashmemo/web -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
