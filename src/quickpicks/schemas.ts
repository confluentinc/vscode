import * as vscode from "vscode";
import { ResourceLoader } from "../loaders/";
import { getConnectionLabel } from "../models/resource";
import { getSubjectIcon, Schema, SchemaType } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";

/** Quickpick returning a string for what to use as a schema subject out of the preexisting options.
 * @returns nonempty string if user chose an existing subject name.
 * @returns empty string if user gestures to create a new subject.
 * @returns undefined if user cancelled the quickpick.
 *
 */
export async function schemaSubjectQuickPick(
  schemaRegistry: SchemaRegistry,
  title?: string,
): Promise<string | undefined> {
  const loader = ResourceLoader.getInstance(schemaRegistry.connectionId);

  const schemaSubjects = await loader.getSubjects(schemaRegistry);

  // Convert to quickpick items, first entry to create a new schema / subject followed by a separator
  const newSchemaLabel = "Create new schema / subject";
  let subjectItems: vscode.QuickPickItem[] = [
    {
      label: newSchemaLabel,
      iconPath: new vscode.ThemeIcon("add"),
    },
    {
      kind: vscode.QuickPickItemKind.Separator,
      // TODO: Perhaps also mix in the 'environment' name here, esp. if ccloud-y or in future direct connect?
      label: getConnectionLabel(loader.connectionType),
    },
  ];

  // Wire up all of the exsting schema registry subjects as items
  // with the description as the subject name for easy return value.
  for (const subject of schemaSubjects) {
    subjectItems.push({
      label: subject,
      iconPath: getSubjectIcon(subject),
    });
  }

  const chosenSubject: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    subjectItems,
    {
      title,
      placeHolder: "Select existing subject or to create a new one",
      ignoreFocusOut: true,
    },
  );

  if (!chosenSubject) {
    // User aborted.
    return undefined;
  }

  if (chosenSubject.label === newSchemaLabel) {
    // Chose the 'create new schema' option.
    return "";
  }

  return chosenSubject.label;
}

/** Quickpick over possible schema types. */
export async function schemaTypeQuickPick(): Promise<SchemaType | undefined> {
  const schemaTypes = Object.values(SchemaType);
  const chosenType = await vscode.window.showQuickPick(schemaTypes, {
    placeHolder: "Choose a schema type",
    ignoreFocusOut: true,
  });

  if (!chosenType) {
    return undefined;
  }

  return chosenType as SchemaType;
}

/** Quickpick over the versions of a schema based on its subject. */
export async function schemaVersionQuickPick(
  schemaRegistry: SchemaRegistry,
  subject: string,
): Promise<Schema | undefined> {
  const loader = ResourceLoader.getInstance(schemaRegistry.connectionId);
  const schemaVersions: Schema[] = await loader.getSchemasForEnvironmentId(
    schemaRegistry.environmentId,
  );
  const schemasMatchingSubject: Schema[] = schemaVersions.filter(
    (schema) => schema.subject === subject,
  );

  const versionItems: vscode.QuickPickItem[] = schemasMatchingSubject.map((schema) => ({
    label: `v${schema.version.toString()}`,
    description: schema.isHighestVersion ? `${schema.id} (latest)` : schema.id,
  }));
  const chosenVersionItem: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    versionItems,
    {
      title: `Schema versions for ${subject}`,
      placeHolder: "Select a schema version",
      ignoreFocusOut: true,
    },
  );

  if (!chosenVersionItem) {
    return;
  }
  return schemaVersions.find(
    (schema) =>
      schema.id === chosenVersionItem.description?.split(" ")[0] &&
      schema.version === parseInt(chosenVersionItem.label.replace("v", ""), 10),
  );
}
