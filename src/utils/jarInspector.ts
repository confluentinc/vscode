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

// Promisified open for convenience
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
 * Error type for JAR inspection failures so callers can distinguish.
 */
export class JarInspectionError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "JarInspectionError";
  }
}

/**
 * List the raw entries of a JAR (zip) archive using yauzl (pure JS, no external tools).
 * @param jarPath Absolute filesystem path
 * @returns Array of entry file names contained in the archive
 */
export async function listJarContents(jarPath: string): Promise<string[]> {
  try {
    await fs.promises.access(jarPath, fs.constants.R_OK);
  } catch (e) {
    throw new JarInspectionError(`JAR file not readable: ${jarPath}`, e);
  }

  if (path.extname(jarPath).toLowerCase() !== ".jar") {
    logger.warn("File inspected does not have .jar extension", { jarPath });
  }

  return new Promise<string[]>((resolve, reject) => {
    const entries: string[] = [];

    openZip(jarPath)
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
        zipFile.on("error", (err: Error) =>
          reject(new JarInspectionError("Error reading JAR entries", err)),
        );
      })
      .catch((err: unknown) =>
        reject(new JarInspectionError("Failed to open JAR (is it a valid zip archive?)", err)),
      );
  });
}

/**
 * Inspect a JAR file and extract Java class names.
 * Filters out inner classes and META-INF resources.
 * @param jarPath Absolute path to JAR
 */
export async function inspectJarClasses(jarPath: string): Promise<JarClassInfo[]> {
  try {
    const entries = await listJarContents(jarPath);
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
    if (err instanceof JarInspectionError) {
      throw err; // Preserve semantic error
    }
    throw new JarInspectionError("Unexpected error while inspecting JAR", err);
  }
}
