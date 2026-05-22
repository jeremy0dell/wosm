import { defineConfig } from "vitest/config";
import { commonResolveConfig, commonTestConfig } from "./vitest.config.shared";

export default defineConfig({
  ...commonResolveConfig,
  test: {
    ...commonTestConfig,
    include: ["tests/e2e/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    passWithNoTests: true,
  },
});
