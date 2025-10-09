import fs from "fs";
import path from "path";
import yauzl, { Entry, ZipFile } from "yauzl";
import { Logger } from "../logging";

/**
 * Interface representing a class found in a JAR file.
 */
export interface JarClassInfo {
  /** The fully qualified class name */
  className: string;
  /** The simple class name (without package) */
  simpleName: string;
}

const logger = new Logger("utils/jarInspector");

// Promisified open for convenience, using yauzl library
const openZip = (filePath: string): Promise<ZipFile> =>
  new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true },
      (err: Error | null, zipFile: ZipFile | undefined) => {
        if (err || !zipFile) {
          reject(err ?? new Error("Failed to open zip file"));
          return;
        }
        resolve(zipFile);
      },
    );
  });

/**
 * List the raw entries of a JAR (zip) archive
 * @param filePath Absolute filesystem path
 * @returns Array of file names contained in the archive
 */
export async function listJarContents(filePath: string): Promise<string[]> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch (e) {
    throw new Error(`JAR file not readable: ${filePath}`, e);
  }

  if (path.extname(filePath).toLowerCase() !== ".jar") {
    logger.warn("File inspected does not have .jar extension", { filePath });
  }

  return new Promise<string[]>((resolve, reject) => {
    const entries: string[] = [];

    openZip(filePath)
      .then((zipFile) => {
        zipFile.readEntry();
        zipFile.on("entry", (entry: Entry) => {
          // Directories end with '/'
          if (/\/$/.test(entry.fileName)) {
            zipFile.readEntry();
            return;
          }
          entries.push(entry.fileName);
          zipFile.readEntry();
        });
        zipFile.on("end", () => resolve(entries));
        zipFile.on("error", (err: Error) => reject(new Error("Error reading JAR entries", err)));
      })
      .catch((err) => reject(new Error("Failed to open JAR (is it a valid zip archive?)", err)));
  });
}

/**
 * Inspect a JAR file and extract Java class names.
 * Filters out inner classes and META-INF resources.
 * @param filePath Absolute path to JAR
 */
export async function inspectJarClasses(filePath: string): Promise<JarClassInfo[]> {
  try {
    const entries = await listJarContents(filePath);
    const classFiles = entries.filter(
      (f) => f.endsWith(".class") && !f.includes("$") && !f.startsWith("META-INF/"),
    );
    const infos: JarClassInfo[] = classFiles.map((filePath) => {
      const className = filePath
        .replace(/\\/g, "/")
        .replace(/\.class$/, "")
        .replace(/\//g, ".");
      const simpleName = className.split(".").pop() || className;
      return { className, simpleName };
    });
    logger.debug("inspectJarClasses: extracted classes", { count: infos.length });
    return infos;
  } catch (err) {
    if (err instanceof Error) {
      throw err; // Preserve existing error
    }
    throw new Error("Unexpected error while inspecting JAR", err);
  }
}
