import fs from "fs";
import path from "path";
import { type Uri } from "vscode";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { Logger } from "../logging";
import { logUsage, UserEvent } from "../telemetry/events";

export interface JarClassInfo {
  /** The fully qualified class name */
  className: string;
  /** The simple class name (without package) */
  simpleName: string;
}

const logger = new Logger("utils.jarInspector");
/**
 * Inspect a JAR file and extract Java class names.
 * Filters out inner classes and META-INF resources.
 * @param file VSCode Uri of the JAR file
 */
export async function inspectJarClasses(file: Uri): Promise<JarClassInfo[]> {
  try {
    const fileNames = await listJarContents(file.fsPath);
    const classFiles = fileNames.filter(
      (f) => f.endsWith(".class") && !f.includes("$") && !f.startsWith("META-INF/"),
    );
    const infos: JarClassInfo[] = classFiles.map((filePath) => {
      const className = filePath.replace(/\.class$/, "").replace(/\//g, ".");
      const simpleName = className.split(".").pop() || className;
      return { className, simpleName };
    });
    logger.debug("inspectJarClasses: extracted classes", { count: infos.length });
    logUsage(UserEvent.FlinkUDFAction, {
      action: "created",
      status: "ok",
      kind: "quick-register",
      step: "jar inspection: class extraction",
      numClasses: infos.length,
    });
    return infos;
  } catch (err) {
    throw new Error("Unable to inspect JAR file", { cause: err });
  }
}

/**
 * List the raw entries of a JAR (zip) archive
 * @param filePath Absolute filesystem path
 * @returns Array of file names contained in the archive
 */
export async function listJarContents(filePath: string): Promise<string[]> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch (e) {
    logger.error("JAR file not readable", { filePath, error: (e as Error).message });
    throw new Error(`JAR file not readable: ${filePath}`);
  }

  if (path.extname(filePath).toLowerCase() !== ".jar") {
    logger.warn("File inspected does not have .jar extension");
    throw new Error(`File inspected does not have .jar extension: ${filePath}`);
  }

  // Promisified yauzl APIs
  // https://github.com/thejoshwolfe/yauzl/blob/master/examples/promises.js
  return new Promise<string[]>((resolve, reject) => {
    const entries: string[] = [];
    openZip(filePath)
      .then((zipFile) => {
        zipFile.readEntry(); // readEntry() causes this ZipFile to emit an entry or end event (or an error event).
        zipFile.on("entry", (entry: Entry) => {
          // Skip directories
          if (/\/$/.test(entry.fileName)) {
            zipFile.readEntry();
            return;
          }
          entries.push(entry.fileName);
          zipFile.readEntry();
        });
        zipFile.on("end", () => resolve(entries));
        zipFile.on("error", (err) => reject(err));
      })
      .catch((err) => reject(err));
  });
}

// Promisified yauzl open method
// https://github.com/thejoshwolfe/yauzl/blob/master/examples/promises.js
const openZip = (filePath: string): Promise<ZipFile> =>
  new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true },
      (err: Error | null, zipFile: ZipFile | undefined) => {
        if (err || !zipFile) {
          reject(err ?? new Error("Failed to unzip .jar file"));
          return;
        }
        resolve(zipFile);
      },
    );
  });
