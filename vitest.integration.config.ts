import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000
  }
});
