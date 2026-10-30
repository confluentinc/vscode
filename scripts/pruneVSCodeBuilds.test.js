import assert from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { pruneVSCodeBuilds } from "./pruneVSCodeBuilds.js";

const CURRENT_BUILD = "vscode-darwin-arm64-1.138.0";
const OLD_BUILDS = ["vscode-darwin-arm64-1.131.0", "vscode-darwin-arm64-1.137.0"];
const INSIDERS_BUILD = "vscode-darwin-arm64-insiders";
const OTHER_PLATFORM_BUILD = "vscode-linux-x64-1.131.0";
const NON_BUILD_ENTRIES = ["extensions", "user-data"];
const WINDOWS_CURRENT_BUILD = "vscode-win32-x64-archive-1.138.0";
const WINDOWS_OLD_BUILD = "vscode-win32-x64-archive-1.137.0";
const WINDOWS_OTHER_ARCH_BUILD = "vscode-win32-arm64-archive-1.137.0";

let cachePath;

beforeEach(() => {
  cachePath = mkdtempSync(join(tmpdir(), "prune-vscode-builds-"));
});

afterEach(() => {
  rmSync(cachePath, { recursive: true, force: true });
});

function createEntries(names) {
  for (const name of names) {
    mkdirSync(join(cachePath, name));
  }
}

function executablePathFor(buildDir) {
  return join(cachePath, buildDir, "Visual Studio Code.app", "Contents", "MacOS", "Code");
}

test("removes other release builds for the platform in use", () => {
  const kept = [CURRENT_BUILD, INSIDERS_BUILD, OTHER_PLATFORM_BUILD, ...NON_BUILD_ENTRIES];
  createEntries([...kept, ...OLD_BUILDS]);

  const result = pruneVSCodeBuilds(cachePath, executablePathFor(CURRENT_BUILD));

  assert.deepStrictEqual(result, { removed: [...OLD_BUILDS].sort(), failed: [] });
  assert.deepStrictEqual(readdirSync(cachePath).sort(), kept.sort());
});

test("recognizes Windows archive build names", () => {
  createEntries([WINDOWS_CURRENT_BUILD, WINDOWS_OLD_BUILD, WINDOWS_OTHER_ARCH_BUILD]);

  const result = pruneVSCodeBuilds(cachePath, join(cachePath, WINDOWS_CURRENT_BUILD, "Code.exe"));

  assert.deepStrictEqual(result.removed, [WINDOWS_OLD_BUILD]);
  assert.deepStrictEqual(
    readdirSync(cachePath).sort(),
    [WINDOWS_CURRENT_BUILD, WINDOWS_OTHER_ARCH_BUILD].sort(),
  );
});

test("removes nothing when the build in use is insiders", () => {
  const entries = [INSIDERS_BUILD, CURRENT_BUILD, ...OLD_BUILDS];
  createEntries(entries);

  const result = pruneVSCodeBuilds(cachePath, executablePathFor(INSIDERS_BUILD));

  assert.deepStrictEqual(result, { removed: [], failed: [] });
  assert.deepStrictEqual(readdirSync(cachePath).sort(), entries.sort());
});

test("throws without removing anything when the executable is outside the cache", () => {
  const entries = [CURRENT_BUILD, ...OLD_BUILDS];
  createEntries(entries);

  assert.throws(
    () => pruneVSCodeBuilds(cachePath, join(tmpdir(), "elsewhere", "Code")),
    /not in a recognized VS Code build directory/,
  );

  assert.deepStrictEqual(readdirSync(cachePath).sort(), entries.sort());
});
