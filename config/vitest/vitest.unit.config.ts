import { defineConfig } from "vitest/config";
import { commonResolveConfig, commonTestConfig } from "./vitest.config.shared";

export default defineConfig({
  ...commonResolveConfig,
  test: {
    ...commonTestConfig,
    include: [
      "apps/*/test/unit/**/*.test.ts",
      "apps/*/test/unit/**/*.test.tsx",
      "apps/*/src/**/__tests__/**/*.test.ts",
      "apps/*/src/**/__tests__/**/*.test.tsx",
      "packages/*/test/unit/**/*.test.ts",
      "integrations/*/*/test/unit/**/*.test.ts",
    ],
  },
});
