import * as fs from "fs";
import * as path from "path";

/**
 * Loads a JSON fixture file from the fixtures directory
 * @param relativePath - Path relative to the fixtures directory (e.g. 'flink-statement-results-processing/get-statement-results-1.json')
 * @returns The parsed JSON content of the fixture file
 */
export function loadFixture(relativePath: string): any {
  const fixturePath = path.join(__dirname, relativePath);
  const content = fs.readFileSync(fixturePath, "utf8");
  return JSON.parse(content);
}
