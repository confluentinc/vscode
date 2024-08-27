import { validateBump } from "./validateBump.js";
import test from "node:test";
import assert from "assert";

test("validateBump", () => {
  const testCases = [
    {
      packageJson: `{"version": "1.0.0-1"}`,
      nextTxtContents: "1.0.1",
      gitBranch: "v1.0.x",
      expectedBump: "patch",
    },
    {
      packageJson: `{"version": "1.0.0-12"}`,
      nextTxtContents: "1.0.1",
      gitBranch: "v1.0.x",
      expectedBump: "patch",
    },
    {
      packageJson: `{"version": "1.1.0-4"}`,
      nextTxtContents: "1.2.0",
      gitBranch: "main",
      expectedBump: "minor",
    },
    {
      packageJson: `{"version": "1.0.0"}`,
      nextTxtContents: "2.0.0",
      gitBranch: "main",
      expectedBump: "major",
    },
    {
      packageJson: `{"version": "1.0.0-12"}`,
      nextTxtContents: "2.0.0",
      gitBranch: "main",
      expectedBump: "major",
    },
    {
      packageJson: `{"version": "1.0.0"}`,
      nextTxtContents: "1.2.3",
      gitBranch: "main",
      expectedErrorMessage: "invalid bump",
    },
    {
      packageJson: `{"version": "1.0.0-5"}`,
      nextTxtContents: "1.2.3",
      gitBranch: "main",
      expectedErrorMessage: "invalid bump",
    },
    {
      packageJson: `{"version": "1.0.0"}`,
      nextTxtContents: "1.0.1",
      gitBranch: "feature/xyz",
      expectedErrorMessage: "Invalid branch for patch bump",
    },
    {
      packageJson: `{"version": "1.0.0-3"}`,
      nextTxtContents: "1.0.1",
      gitBranch: "feature/xyz",
      expectedErrorMessage: "Invalid branch for patch bump",
    },
    {
      packageJson: `{"version": "1.0.0"}`,
      nextTxtContents: "1.1.0",
      gitBranch: "develop",
      expectedErrorMessage: "Invalid branch for minor bump",
    },
    {
      packageJson: `{"version": "1.0.0"}`,
      nextTxtContents: "2.0.0",
      gitBranch: "feature/major-update",
      expectedErrorMessage: "Invalid branch for major bump",
    },
    // Test that providing a micro-version in the next.txt will fail
    // with "invalid bump"
    {
      packageJson: `{"version": "1.0.0-12"}`,
      nextTxtContents: "2.0.0-3",
      gitBranch: "main",
      expectedErrorMessage: "invalid bump",
    },
  ];

  testCases.forEach((testCase) => {
    const mockReadFileVersion = () => testCase.packageJson;
    const mockReadNextVersion = () => testCase.nextTxtContents;
    const gitBranch = testCase.gitBranch;

    if (testCase.expectedErrorMessage) {
      assert.throws(
        () => validateBump(mockReadFileVersion, mockReadNextVersion, gitBranch),
        new Error(testCase.expectedErrorMessage),
      );
    } else {
      const bump = validateBump(mockReadFileVersion, mockReadNextVersion, gitBranch);
      assert(bump, testCase.expectedBump);
    }
  });
});
