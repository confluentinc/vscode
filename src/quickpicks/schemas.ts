import * as vscode from "vscode";
import { IconNames } from "../constants";
import { ResourceLoader } from "../loaders/";
import { Logger } from "../logging";
import { getConnectionLabel } from "../models/resource";
import { getSubjectIcon, Schema, SchemaType, Subject } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { SubjectNameStrategy } from "../schemas/produceMessageSchema";
import { logUsage, UserEvent } from "../telemetry/events";
import { QuickPickItemWithValue } from "./constants";

const logger = new Logger("quickpicks.schemas");

/** Quickpick returning a string for what to use as a schema subject out of the preexisting options.
 *
 * @param schemaRegistry The schema registry to query for existing subjects.
 * @param includeCreateNew Whether to include the option to create a new subject. (default: `true`)
 * @param title Optional title of the quickpick.
 * @param filterPredicate Optional predicate to filter the subjects shown.
 *
 * @returns nonempty string if user chose an existing subject name.
 * @returns empty string if user gestures to create a new subject.
 * @returns undefined if user cancelled the quickpick.
 *
 */
export async function schemaSubjectQuickPick(
  schemaRegistry: SchemaRegistry,
  includeCreateNew: boolean = true,
  title?: string,
  filterPredicate?: (subject: Subject) => boolean,
): Promise<string | undefined> {
  const loader = ResourceLoader.getInstance(schemaRegistry.connectionId);

  const schemaSubjects: Subject[] = await loader.getSubjects(schemaRegistry);

  let subjectItems: vscode.QuickPickItem[] = [];

  const newSchemaLabel = "Create new subject";
  if (includeCreateNew) {
    subjectItems.push(
      {
        label: newSchemaLabel,
        iconPath: new vscode.ThemeIcon("add"),
      },
      {
        kind: vscode.QuickPickItemKind.Separator,
        // TODO: Perhaps also mix in the 'environment' name here, esp. if ccloud-y or in future direct connect?
        label: getConnectionLabel(loader.connectionType),
      },
    );
  }

  // Wire up all of the exsting schema registry subjects as items
  // with the description as the subject name for easy return value.
  for (const subject of schemaSubjects) {
    if (filterPredicate && !filterPredicate(subject)) {
      continue;
    }
    subjectItems.push({
      label: subject.name,
      iconPath: getSubjectIcon(subject.name),
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
  if (schemasMatchingSubject.length === 1) {
    // skip the quickpick if there's only one version
    return schemasMatchingSubject[0];
  }

  const versionItems: vscode.QuickPickItem[] = schemasMatchingSubject.map((schema) => ({
    label: `v${schema.version.toString()}`,
    description: schema.isHighestVersion ? `${schema.id} (latest)` : schema.id,
  }));
  const chosenVersionItem: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    // sort by version in descending order (latest at the top)
    versionItems.sort((a, b) => b.label.localeCompare(a.label)),
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

export type SchemaKindSelection = {
  keySchema: boolean;
  valueSchema: boolean;
  deferToDocument: boolean;
};

/**
 * Quickpick to (multi-)select which schema kind (key and/or value).
 *
 * If the provided `topic` is already associated with a schema based on the `TopicNameStrategy`,
 * pre-select that kind.
 *
 * Deselecting any pre-selected kind(s) will show a confirmation warning modal to confirm the user
 * wants to produce without schema(s).
 */
export async function subjectKindMultiSelect(
  topic: KafkaTopic,
): Promise<SchemaKindSelection | undefined> {
  const topicKeySubjects: Subject[] = topic.children.filter((subject: Subject) =>
    subject.name.endsWith("-key"),
  );
  const topicKeySubjectNames: string[] = topicKeySubjects.map((subject) => subject.name);
  const topicValueSubjects: Subject[] = topic.children.filter((subject: Subject) =>
    subject.name.endsWith("-value"),
  );
  const topicValueSubjectNames: string[] = topicValueSubjects.map((subject) => subject.name);

  // pre-pick any schema kinds that are already associated with this topic
  const keySchemaLabel = "Key Schema";
  const valueSchemaLabel = "Value Schema";
  const useDocumentLabel = "Advanced: Use File/Editor Contents";

  const items: vscode.QuickPickItem[] = [
    {
      label: keySchemaLabel,
      description: topicKeySubjects.length > 0 ? topicKeySubjectNames.join(", ") : undefined,
      picked: topicKeySubjects.length > 0,
      iconPath: new vscode.ThemeIcon(IconNames.KEY_SUBJECT),
    },
    {
      label: valueSchemaLabel,
      description: topicValueSubjects.length > 0 ? topicValueSubjectNames.join(", ") : undefined,
      picked: topicValueSubjects.length > 0,
      iconPath: new vscode.ThemeIcon(IconNames.VALUE_SUBJECT),
    },
    {
      label: "",
      kind: vscode.QuickPickItemKind.Separator,
    },
    {
      label: useDocumentLabel,
      description: "File contents must specify subject, schema version, and subject name strategy",
      iconPath: new vscode.ThemeIcon("warning"),
      picked: false,
    },
  ];

  const selectedItems: vscode.QuickPickItem[] | undefined = await vscode.window.showQuickPick(
    items,
    {
      canPickMany: true,
      title: `Producing to ${topic.name}: Select Schema Kind(s)`,
      placeHolder: "Select which schema kind(s) to use",
      ignoreFocusOut: true,
    },
  );
  if (selectedItems === undefined) {
    // user cancelled
    return;
  }

  let keySchemaSelected: boolean = false;
  let valueSchemaSelected: boolean = false;
  const useDocumentSelected: boolean =
    selectedItems?.some((item) => item.label === useDocumentLabel) ?? false;
  if (!useDocumentSelected) {
    keySchemaSelected = selectedItems?.some((item) => item.label === keySchemaLabel) ?? false;
    valueSchemaSelected = selectedItems?.some((item) => item.label === valueSchemaLabel) ?? false;
  }

  // if the user didn't select key/value but a topic subject exists matching the TopicNameStrategy,
  // warn them that they are producing to a topic with an existing schema
  const ignoringKeySchema: boolean = !keySchemaSelected && topicKeySubjects.length > 0;
  const ignoringValueSchema: boolean = !valueSchemaSelected && topicValueSubjects.length > 0;
  if (!useDocumentSelected && (ignoringKeySchema || ignoringValueSchema)) {
    const ignoredSchemas: string[] = [];
    const ignoredKinds: string[] = [];
    if (ignoringKeySchema) {
      ignoredSchemas.push(...topicKeySubjectNames);
      ignoredKinds.push("key");
    }
    if (ignoringValueSchema) {
      ignoredSchemas.push(...topicValueSubjectNames);
      ignoredKinds.push("value");
    }

    const plural: string = ignoredSchemas.length > 1 ? "s" : "";
    const ignoredSchemasString: string = ignoredSchemas.join(", ");
    const ignoredKindsString: string =
      ignoredKinds.length > 1 ? "key or value schemas" : `a ${ignoredKinds[0]} schema`;

    const yesButton = `Yes, produce without schema${plural}`;
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to produce to "${topic.name}" without ${ignoredKindsString}?`,
      {
        modal: true,
        detail: `The following schema subject${plural} already exist${plural ? "" : "s"} for this topic: ${ignoredSchemasString}`,
      },
      yesButton,
      // "Cancel" is added by default
    );
    if (confirmation !== yesButton) {
      logUsage(UserEvent.MessageProduceAction, {
        status: "exited from key/value schema warning",
        keySchemaSelected,
        valueSchemaSelected,
        useDocumentSelected,
        topicHasKeySchema: topicKeySubjects.length > 0,
        topicHasValueSchema: topicValueSubjects.length > 0,
      });
      return;
    }
    logger.warn(
      `producing to ${topic.name} without schema(s) despite associated schema subject${plural}: ${ignoredSchemasString}`,
    );
    logUsage(UserEvent.MessageProduceAction, {
      status: "selected produce without associated schema(s)",
      keySchemaSelected,
      valueSchemaSelected,
      useDocumentSelected,
      topicHasKeySchema: topicKeySubjects.length > 0,
      topicHasValueSchema: topicValueSubjects.length > 0,
    });
  } else {
    logUsage(UserEvent.MessageProduceAction, {
      status: "selected produce with schema(s)",
      keySchemaSelected,
      valueSchemaSelected,
      useDocumentSelected,
      topicHasKeySchema: topicKeySubjects.length > 0,
      topicHasValueSchema: topicValueSubjects.length > 0,
    });
  }

  return {
    keySchema: keySchemaSelected,
    valueSchema: valueSchemaSelected,
    deferToDocument: useDocumentSelected,
  };
}

/**
 * Quickpick to select which subject name strategy to use.
 *
 * @param topic The topic to produce to, used to pre-fill the subject name.
 * @param kind The kind of schema (key or value) to reference.
 */
export async function subjectNameStrategyQuickPick(
  topic: KafkaTopic,
  kind: "key" | "value",
): Promise<SubjectNameStrategy | undefined> {
  const docsLabel = "View Documentation";
  const docsLink =
    "https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/index.html#overview";

  const items: QuickPickItemWithValue<SubjectNameStrategy>[] = [
    {
      label: "TopicNameStrategy",
      value: SubjectNameStrategy.TOPIC_NAME,
      description: `${topic.name}-${kind} (default)`,
    },
    {
      label: "TopicRecordNameStrategy",
      value: SubjectNameStrategy.TOPIC_RECORD_NAME,
      description: `${topic.name}-<fully-qualified record name>`,
    },
    {
      label: "RecordNameStrategy",
      value: SubjectNameStrategy.RECORD_NAME,
      description: `<fully-qualified record name>`,
    },
    {
      label: "",
      kind: vscode.QuickPickItemKind.Separator,
    },
    {
      label: docsLabel,
      iconPath: new vscode.ThemeIcon("link-external"),
    },
  ];

  const selectedItem: QuickPickItemWithValue<SubjectNameStrategy> | undefined =
    await vscode.window.showQuickPick(items, {
      title: `Producing to ${topic.name}: ${kind} Subject Name Strategy`,
      placeHolder: "Select which subject naming strategy to use",
      ignoreFocusOut: true,
    });
  if (!selectedItem) {
    return;
  }

  if (selectedItem.label === docsLabel) {
    // open docs page in the user's default browser
    vscode.env.openExternal(vscode.Uri.parse(docsLink));
    return;
  }

  return selectedItem.value;
}
