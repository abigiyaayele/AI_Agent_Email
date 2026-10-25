import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20000,
    setupFiles: ["tests/setup-env.ts"],
  },
});
