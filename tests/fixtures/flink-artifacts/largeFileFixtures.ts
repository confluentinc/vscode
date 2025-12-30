import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Creates a file larger than 100MB for testing file size validation.
 * The file is filled with random data to simulate a real artifact file.
 *
 * @param fileSizeInMB - The size of the file to create in megabytes (default: 101MB)
 * @param fileName - Optional custom filename (default: "large-test-artifact-{timestamp}.jar")
 * @param targetDir - Optional target directory (default: system temp directory)
 * @returns The full path to the created file
 *
 * @example
 * const largeFilePath = createLargeFile(150, "my-large-file.jar");
 * // Use the file in tests...
 * deleteLargeFile(largeFilePath);
 */
export function createLargeFile(
  fileSizeInMB: number = 101,
  fileName?: string,
  targetDir?: string,
): string {
  const dir = targetDir || os.tmpdir();
  const name = fileName || `large-test-artifact-${Date.now()}.jar`;
  const filePath = path.join(dir, name);

  // Calculate file size in bytes
  const fileSizeInBytes = fileSizeInMB * 1024 * 1024;

  // Create a buffer with a reasonable chunk size (10MB) to write efficiently
  const chunkSize = 10 * 1024 * 1024;
  const chunk = Buffer.alloc(chunkSize);

  // Fill the chunk with random data to simulate a real file
  for (let i = 0; i < chunkSize; i++) {
    chunk[i] = Math.floor(Math.random() * 256);
  }

  // Write the file in chunks
  const fileHandle = fs.openSync(filePath, "w");
  try {
    let bytesWritten = 0;
    while (bytesWritten < fileSizeInBytes) {
      const bytesToWrite = Math.min(chunkSize, fileSizeInBytes - bytesWritten);
      fs.writeSync(fileHandle, chunk, 0, bytesToWrite);
      bytesWritten += bytesToWrite;
    }
  } finally {
    fs.closeSync(fileHandle);
  }

  return filePath;
}

/**
 * Deletes a test file created by createLargeFile.
 * Safely handles errors if the file doesn't exist or can't be deleted.
 *
 * @param filePath - The full path to the file to delete
 * @returns true if the file was successfully deleted, false otherwise
 *
 * @example
 * const largeFilePath = createLargeFile();
 * // Use the file in tests...
 * const deleted = deleteLargeFile(largeFilePath);
 * if (!deleted) {
 *   console.warn("Failed to clean up test file");
 * }
 */
export function deleteLargeFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Failed to delete file ${filePath}:`, error);
    return false;
  }
}

/**
 * Creates a large file in the flink-artifacts fixtures directory for e2e testing.
 * This is useful when you need a large artifact file that persists in the fixtures directory.
 *
 * @param fileSizeInMB - The size of the file to create in megabytes (default: 101MB)
 * @param fileName - The name of the file (default: "large-artifact-{timestamp}.jar")
 * @returns The full path to the created file in the fixtures directory
 *
 * @example
 * import { fileURLToPath } from "url";
 * import path from "path";
 *
 * const __filename = fileURLToPath(import.meta.url);
 * const __dirname = path.dirname(__filename);
 *
 * const largeArtifactPath = createLargeFixtureArtifact(150);
 * // Use in e2e test...
 * deleteLargeFile(largeArtifactPath);
 */
export function createLargeFixtureArtifact(fileSizeInMB: number = 101, fileName?: string): string {
  const fixturesDir = path.join(__dirname);
  const name = fileName || `large-artifact-${Date.now()}.jar`;
  return createLargeFile(fileSizeInMB, name, fixturesDir);
}
