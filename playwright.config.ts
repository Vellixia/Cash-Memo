import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/acceptance",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  expect: { timeout: 30_000 },
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: [
    {
      command: "cargo run --manifest-path backend/Cargo.toml -p cashmemo",
      url: "http://127.0.0.1:3001/api/v1/auth/session",
      reuseExistingServer: false,
      timeout: 180_000,
      env: { ...process.env, CASHMEMO_HTTP_BIND: "127.0.0.1:3001" },
    },
    {
      command: "bash scripts/acceptance/start-production-web.sh",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        ...process.env,
        CASHMEMO_API_ORIGIN: "http://127.0.0.1:3001",
        NODE_ENV: "production",
      },
    },
  ],
});
