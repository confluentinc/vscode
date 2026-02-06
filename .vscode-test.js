import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  tests: [
    {
      files: "out/**/*.test.js",
      mocha: {
        ui: "bdd",
        color: true,
        timeout: 10_000,
        require: ["./out/tests/unit/globalSetup.js"],
      },
      launchArgs: [
        "--no-sandbox",
        "--profile-temp",
        "--skip-release-notes",
        "--skip-welcome",
        "--disable-gpu",
        "--disable-updates",
        "--disable-workspace-trust",
        "--disable-extensions",
      ],
    },
  ],
  coverage: {
    // add the `**/` prefix to match absolute resolved paths after source-map resolution
    include: ["**/src/**"],
    exclude: [
      "**/src/testing.ts",
      "**/src/clients/**",
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/*.*.js",
      "**/*.d.ts",
    ],
    // also include files with no associated tests so we don't get over-inflated coverage numbers
    includeAll: true,
    reporter: ["html"],
  },
});
