import { readdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";

// same download directory naming as @vscode/test-electron, e.g. "vscode-darwin-arm64-1.138.0"
const RELEASE_BUILD_DIR = /^vscode-(?<platform>[a-z0-9-]+)-[0-9.]+$/;
const INSIDERS_BUILD_DIR = /^vscode-[a-z0-9-]+-insiders$/;

/**
 * Removes VS Code release builds in `cachePath` other than the one containing
 * `keepExecutablePath`, since @vscode/test-electron keeps every release it has ever downloaded.
 * Insiders builds are left alone because test-electron already replaces those in place.
 *
 * @param {string} cachePath The `.vscode-test` directory.
 * @param {string} keepExecutablePath Executable path returned by `downloadAndUnzipVSCode()`.
 * @returns {{ removed: string[], failed: { name: string, error: unknown }[] }} Build directory
 *   names that were removed, and those that couldn't be.
 * @throws {Error} If `keepExecutablePath` isn't inside a recognized build directory.
 */
export function pruneVSCodeBuilds(cachePath, keepExecutablePath) {
  const removed = [];
  const failed = [];
  const keepDir = relative(cachePath, keepExecutablePath).split(sep)[0];
  if (INSIDERS_BUILD_DIR.test(keepDir)) {
    return { removed, failed };
  }
  const keepPlatform = RELEASE_BUILD_DIR.exec(keepDir)?.groups.platform;
  if (!keepPlatform) {
    throw new Error(
      `"${keepExecutablePath}" is not in a recognized VS Code build directory under "${cachePath}"`,
    );
  }

  for (const entry of readdirSync(cachePath).sort()) {
    const platform = RELEASE_BUILD_DIR.exec(entry)?.groups.platform;
    if (entry === keepDir || platform !== keepPlatform) {
      continue;
    }
    try {
      // retries cover Windows EBUSY/EPERM from briefly locked files
      rmSync(join(cachePath, entry), { recursive: true, force: true, maxRetries: 3 });
      removed.push(entry);
    } catch (error) {
      failed.push({ name: entry, error });
    }
  }
  return { removed, failed };
}
