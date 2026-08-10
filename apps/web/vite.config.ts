/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2024",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@cashmemo/contracts": "/packages/contracts/src/index.ts",
      "@cashmemo/domain": "/packages/domain/src/index.ts",
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    css: false,
    include: ["tests/**/*.spec.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
  },
});
