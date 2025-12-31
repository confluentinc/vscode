import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface LargeFileOptions {
  /** Size in megabytes. Default is 101MB (just over the 100MB threshold) */
  sizeInMB?: number;
  /** Custom filename. If not provided, a default name will be used */
  filename?: string;
  /** Directory to create the file in. Defaults to system temp directory */
  directory?: string;
}

/**
 * Creates a large file for testing artifact upload rejection.
 * The file is filled with random data to simulate a real artifact.
 *
 * @param options - Configuration options for the large file
 * @returns The absolute path to the created file
 */
export async function createLargeFile(options: LargeFileOptions = {}): Promise<string> {
  const {
    sizeInMB = 101,
    filename = `test-large-artifact-${Date.now()}.jar`,
    directory = os.tmpdir(),
  } = options;

  const filePath = path.join(directory, filename);
  const sizeInBytes = sizeInMB * 1024 * 1024;
  const chunkSize = 1024 * 1024; // 1MB chunks for efficient writing

  const buffer = Buffer.alloc(chunkSize, 0); // Fill with zeros (or any byte)

  const fd = fs.openSync(filePath, "w");
  try {
    for (let written = 0; written < sizeInBytes; written += chunkSize) {
      const bytesToWrite = Math.min(chunkSize, sizeInBytes - written);
      fs.writeSync(fd, buffer, 0, bytesToWrite);
    }
  } finally {
    fs.closeSync(fd); // Always close even if error occurs
  }
  return filePath;
}

/**
 * Cleans up (deletes) a large test file.
 * @param filePath - The absolute path to the file to delete
 */
export async function cleanupLargeFile(filePath: string): Promise<void> {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
