import * as vscode from "vscode";
import { IconNames } from "../constants";
import { Schema } from "../models/schema";
import { getStorageManager } from "../storage";
import { environmentQuickPick } from "./environments";

export async function schemaQuickPick(): Promise<Schema | undefined> {
  const cloudEnvironment = await environmentQuickPick();
  if (!cloudEnvironment) {
    return;
  }

  const schemas: Schema[] | undefined = await getStorageManager().getWorkspaceState(
    `${cloudEnvironment.id}.schemas`,
  );
  if (!schemas) {
    vscode.window.showWarningMessage(`No schemas available for "${cloudEnvironment.name}".`);
    return;
  }

  let schemaItems: vscode.QuickPickItem[] = [];
  const schemaMap: Map<string, Schema> = new Map();
  // sort by subject (ascending) and version (descending)
  schemas.sort((a, b) => {
    if (a.subject < b.subject) {
      return -1;
    } else if (a.subject > b.subject) {
      return 1;
    } else {
      return b.version - a.version;
    }
  });
  for (const schema of schemas) {
    let iconPath: vscode.ThemeIcon;
    if (schema.subject.endsWith("-key")) {
      iconPath = new vscode.ThemeIcon(IconNames.KEY_SUBJECT);
    } else if (schema.subject.endsWith("-value")) {
      iconPath = new vscode.ThemeIcon(IconNames.VALUE_SUBJECT);
    } else {
      iconPath = new vscode.ThemeIcon(IconNames.OTHER_SUBJECT);
    }
    schemaItems.push({
      label: schema.subject,
      description: `v${schema.version}`,
      iconPath: iconPath,
    });
    schemaMap.set(schema.subject, schema);
  }

  const chosenSchema: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    schemaItems,
    {
      placeHolder: "Select a schema",
    },
  );
  return chosenSchema ? schemaMap.get(chosenSchema.label) : undefined;
}
