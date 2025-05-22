import * as fs from "fs";
import * as os from "os";
import * as vscode from "vscode";

/**
 * Very thin wrappers around {@link vscode.workspace.fs} and {@link fs} related methods and functions which cannot
 * be stubbed directly in tests due to implementation directly in C, not JS.
 */

/**
 * Internal wrapper around vscode.workspace.fs.stat for testing purposes.
 * @internal This function exists solely to enable testing since vscode.workspace.fs.stat cannot be directly stubbed.
 * */
export async function statFile(uri: vscode.Uri): Promise<vscode.FileStat> {
  return await vscode.workspace.fs.stat(uri);
}

/**
 * Read a file's contents. Thin wrapper around vscode.workspace.fs.readFile(),
 * for same mocking reasons as statFile().
 * */
export async function readFile(uri: vscode.Uri): Promise<string> {
  const data = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(data).toString("utf8");
}

/**
 * Call vscode.workspace.fs.writeFile() to write a file.
 */
export async function writeFile(uri: vscode.Uri, contents: Uint8Array): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, contents);
}
/**
 * Call vscode.workspace.fs.delete() to delete a file.
 */
export async function deleteFile(uri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.delete(uri);
}

/**
 * Get the system's temporary directory.
 */
export function tmpdir(): string {
  return os.tmpdir();
}

/** Wrapper for fs.writeFileSync() */
export function writeFileSync(
  path: fs.PathOrFileDescriptor,
  data: string | NodeJS.ArrayBufferView,
  options?: fs.WriteFileOptions,
): void {
  fs.writeFileSync(path, data, options);
}

/** Wrapper for fs.openSync() */
export function openSync(path: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null): number {
  return fs.openSync(path, flags, mode);
}

/** Wrapper for fs.closeSync() */
export function closeSync(fd: number): void {
  fs.closeSync(fd);
}
