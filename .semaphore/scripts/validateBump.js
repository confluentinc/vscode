import fs from "fs";

export function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8").trim();
}

export function getGitBranch() {
  return process.env.GIT_BRANCH;
}

export function validateBump(readFileVersion, readNextVersion, gitBranch) {
  const packageJsonVersion = JSON.parse(readFileVersion("package.json"));
  // Remove the microversion from the package.json version
  const packageJsonWithoutMicroversion = packageJsonVersion.version.replace(/-\d+$/, "");
  console.log(`packageJsonWithoutMicroversion: ${packageJsonWithoutMicroversion}`);

  // Split the version string into major, minor, and patch components
  let [major, minor, patch] = packageJsonWithoutMicroversion.split(".").map(Number);

  const nextTxtContents = readNextVersion(".versions/next.txt");
  console.log(`nextTxtContents: ${nextTxtContents}`);

  // Calculate next versions
  const nextPatchVersion = `${major}.${minor}.${patch + 1}`;
  const nextMinorVersion = `${major}.${minor + 1}.0`;
  const nextMajorVersion = `${major + 1}.0.0`;

  let bump = null;
  if (nextTxtContents === nextPatchVersion) {
    bump = "patch";
  } else if (nextTxtContents === nextMinorVersion) {
    bump = "minor";
  } else if (nextTxtContents === nextMajorVersion) {
    bump = "major";
  } else {
    throw new Error("invalid bump");
  }

  if (bump === "patch" && !/^v\d+\.\d+\.x$/.test(gitBranch)) {
    throw new Error("Invalid branch for patch bump");
  } else if ((bump === "minor" || bump === "major") && gitBranch !== "main") {
    throw new Error(`Invalid branch for ${bump} bump`);
  }

  return bump;
}
