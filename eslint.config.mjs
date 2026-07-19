// @ts-check
import eslint from "@eslint/js";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "web/**", "node_modules/**", ".nuxt/**"],
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
  eslintConfigPrettier,
);
