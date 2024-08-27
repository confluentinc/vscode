import { validateBump, readFile, getGitBranch } from "./validateBump.js";

(async () => {
  try {
    // Wrap readFile in a function to match the expected signature
    const readFileVersion = (filePath) => readFile(filePath);
    const readNextVersion = (filePath) => readFile(filePath);

    // Get the current Git branch
    const gitBranch = getGitBranch();
    const bumpType = await validateBump(readFileVersion, readNextVersion, gitBranch);
    console.log("Valid bump:", bumpType);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
})();
