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
});
