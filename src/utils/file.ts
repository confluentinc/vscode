import * as vscode from "vscode";

/** Internal wrapper around vscode.workspace.fs.stat for testing purposes.
 * @internal This function exists solely to enable testing since vscode.workspace.fs.stat cannot be directly stubbed. */
export async function statFile(uri: vscode.Uri): Promise<vscode.FileStat> {
  return await vscode.workspace.fs.stat(uri);
}

/** Check if a file URI exists in the filesystem. */
export async function fileUriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await statFile(uri);
    return true;
  } catch {
    return false;
  }
}
