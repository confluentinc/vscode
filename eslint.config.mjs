import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
import playwright from "eslint-plugin-playwright";
import prettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import requireAsyncStubBehavior from "./.eslint/rules/require-async-stub-behavior.js";

export default [
  {
    files: ["*.js", "*.mjs"],
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ["error", "smart"],
      "no-unused-vars": "warn",
      // ignore line endings between Windows and Unix
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
    languageOptions: {
      globals: {
        ...globals.builtin,
        ...globals.node,
      },
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.mts"],
    ignores: ["src/clients/**"],
    plugins: { "@typescript-eslint": ts },
    rules: {
      ...js.configs.recommended.rules,
      ...ts.configs.recommended.rules,
      eqeqeq: ["error", "smart"],
      // TypeScript covers undefined things instead
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-redeclare": "off",
      // "require-await": "warn",
      "@typescript-eslint/no-unused-vars": "error",
      // Some untyped things may require extra effort to be fixed
      "@typescript-eslint/no-explicit-any": "off",
      // replacement of ESLint's no-redeclare with support for function overload
      "@typescript-eslint/no-redeclare": "error",
      // ignore line endings between Windows and Unix
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
    languageOptions: {
      parser,
      globals: {
        ...globals.builtin,
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["src/**/*.test.ts"],
    languageOptions: { globals: { ...globals.mocha } },
    rules: {
      "local/require-async-stub-behavior": "error",
    },
    plugins: {
      local: {
        rules: {
          "require-async-stub-behavior": requireAsyncStubBehavior,
        },
      },
    },
  },
  {
    files: ["tests/**/*.spec.ts", "tests/**/*.ts", "src/webviews/**/*.ts"],
    ...playwright.configs["flat/recommended"],
    plugins: { playwright, "@typescript-eslint": ts },
    languageOptions: {
      parser,
      globals: {
        ...globals.builtin,
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "playwright/missing-playwright-await": "error",
      "playwright/prefer-web-first-assertions": "error",
      "playwright/no-commented-out-tests": "error",
      "playwright/no-unsafe-references": "error",
      "playwright/no-wait-for-timeout": "error",
      "playwright/valid-describe-callback": "error",
      "playwright/no-conditional-expect": "error",
      "playwright/no-page-pause": "error",
      "playwright/expect-expect": "error",
      "playwright/no-standalone-expect": "error",
      "playwright/no-conditional-in-test": "error",
      "playwright/no-wait-for-selector": "error",
      "playwright/no-force-option": "error",
      "playwright/no-useless-await": "error",
    },
  },
  prettier,
];
