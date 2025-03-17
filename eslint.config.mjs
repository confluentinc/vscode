import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier/recommended";
import globals from "globals";

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
      "@typescript-eslint/no-unused-vars": "warn",
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
  },
  prettier,
];
