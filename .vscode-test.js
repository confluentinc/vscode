import { defineConfig } from "@vscode/test-cli";

export default defineConfig([
  {
    files: "out/**/*.test.js",
    mocha: {
      ui: "bdd",
      color: true,
      timeout: 10_000,
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
]);
