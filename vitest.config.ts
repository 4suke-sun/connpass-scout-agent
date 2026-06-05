import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 50,
        statements: 50,
        branches: 40,
        functions: 50,
      },
      exclude: ["node_modules/**", "dist/**", "**/*.test.ts", "**/*.spec.ts", "vitest.config.ts"],
    },
  },
});
