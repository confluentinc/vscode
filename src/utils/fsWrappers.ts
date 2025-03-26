import * as vscode from "vscode";

/**
 * Very thin wrappers around {@link vscode.workspace.fs} methods which cannot
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
