import { defineConfig } from "vitest/config";
import { commonResolveConfig, commonTestConfig } from "./vitest.config.shared";

export default defineConfig({
  ...commonResolveConfig,
  test: {
    ...commonTestConfig,
    include: [
      "apps/*/test/unit/**/*.test.ts",
      "packages/*/test/unit/**/*.test.ts",
      "integrations/*/*/test/unit/**/*.test.ts",
    ],
  },
});
