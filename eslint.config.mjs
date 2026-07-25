// @ts-check
import eslint from "@eslint/js";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "web/**",
      "node_modules/**",
      ".nuxt/**",
      "renovate-config.js",
    ],
  },
  eslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Build/tooling scripts run under Node (ESM) and use console/process.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // node:test's `test()` returns a promise that is intentionally not awaited
    // when registered at the top level of a test file.
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  eslintConfigPrettier,
);
