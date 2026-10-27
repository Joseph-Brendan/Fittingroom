import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@fitroom/citations": fileURLToPath(new URL("../citations/src/index.ts", import.meta.url)),
      "@fitroom/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@fitroom/directions": fileURLToPath(new URL("../directions/src/index.ts", import.meta.url)),
      "@fitroom/mcp": fileURLToPath(new URL("../mcp/src/index.ts", import.meta.url)),
    },
  },
  test: {
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
