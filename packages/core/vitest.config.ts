import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@fitroom/directions": fileURLToPath(new URL("../directions/src/index.ts", import.meta.url)),
    },
  },
  test: {
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
