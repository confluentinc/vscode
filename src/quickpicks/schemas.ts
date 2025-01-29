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
  onlyType: SchemaType | undefined = undefined,
  defaultSubject: string | undefined = undefined,
): Promise<string | undefined> {
  const loader = ResourceLoader.getInstance(schemaRegistry.connectionId);
  const schemas = await loader.getSchemasForRegistry(schemaRegistry);

  let schemaSubjects: string[] | undefined;

  const latestVersionSchemaBySubject = new Map<string, Schema>();
  if (schemas) {
    // Crunch down to map of subject -> latest version'd Schema for said subject
    for (const schema of schemas) {
      // Skip if the caller asked for only a specific type of schema and this one doesn't match.
      if (onlyType && schema.type !== onlyType) {
        continue;
      }
      const latestVersionSchema = latestVersionSchemaBySubject.get(schema.subject);
      if (!latestVersionSchema || schema.version > latestVersionSchema.version) {
        latestVersionSchemaBySubject.set(schema.subject, schema);
      }
    }

    schemaSubjects = Array.from(latestVersionSchemaBySubject.keys());
    schemaSubjects.sort();
  }

  if (schemas === undefined) {
    schemaSubjects = [];
  }

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
  for (const subject of schemaSubjects!) {
    const latestVersionSchema = latestVersionSchemaBySubject.get(subject);

    subjectItems.push({
      label: subject,
      iconPath: getSubjectIcon(subject),
      description: `v${latestVersionSchema?.version}`,
      alwaysShow: subject === defaultSubject,
    });
  }

  // If defaultSubject is set (and present), make its quickpick item the default selection.
  if (defaultSubject) {
    const defaultSubjectItem = subjectItems.find((item) => item.label === defaultSubject);
    if (defaultSubjectItem) {
      // pop it off the array and re-insert at the front. Being the first item
      // is the only way to make it the default selection when using showQuickPick(), sigh.
      subjectItems = subjectItems.filter((item) => item !== defaultSubjectItem);
      subjectItems.unshift(defaultSubjectItem);
    }
  }

  const chosenSubject: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    subjectItems,
    {
      placeHolder: "Select existing subject or to create a new one",
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
  });

  if (!chosenType) {
    return undefined;
  }

  return chosenType as SchemaType;
}
