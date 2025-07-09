import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads a fixture file from the fixtures directory. Callers will need to parse the resulting string
 * output as needed.
 * @param relativePath - Path relative to the fixtures directory (e.g. 'flink-statement-results-processing/get-statement-results-1.json')
 * @returns The string content of the file
 */
export function loadFixtureFromFile(relativePath: string): string {
  const fixturePath = path.join(__dirname, relativePath);
  return fs.readFileSync(fixturePath, "utf8");
}
