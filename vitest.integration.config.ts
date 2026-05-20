import { defineConfig } from "vitest/config";
import { commonResolveConfig, commonTestConfig } from "./vitest.config.shared";

export default defineConfig({
  ...commonResolveConfig,
  test: {
    ...commonTestConfig,
    include: [
      "apps/*/test/integration/**/*.test.ts",
      "packages/*/test/integration/**/*.test.ts",
      "integrations/*/*/test/integration/**/*.test.ts",
    ],
  },
});
