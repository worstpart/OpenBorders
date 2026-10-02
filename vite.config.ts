import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2023",
    sourcemap: true,
  },
  test: {
    // All tests live in tests/ (mirroring src/), so src/sim never imports a test framework.
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
