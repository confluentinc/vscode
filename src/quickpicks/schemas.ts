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

const logger = new Logger("quickpicks.schemas");

/** Quickpick returning a string for what to use as a schema subject out of the preexisting options.
 * @returns nonempty string if user chose an existing subject name.
 * @returns empty string if user gestures to create a new subject.
 * @returns undefined if user cancelled the quickpick.
 *
 */
export async function schemaSubjectQuickPick(
  schemaRegistry: SchemaRegistry,
  includeCreateNew: boolean = true,
  title?: string,
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

export type SchemaKindSelection = {
  keySchema: boolean;
  valueSchema: boolean;
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
  const items: vscode.QuickPickItem[] = [
    {
      label: "Key Schema",
      description: topicKeySubjects.length > 0 ? topicKeySubjectNames.join(", ") : undefined,
      picked: topicKeySubjects.length > 0,
      iconPath: new vscode.ThemeIcon(IconNames.KEY_SUBJECT),
    },
    {
      label: "Value Schema",
      description: topicValueSubjects.length > 0 ? topicValueSubjectNames.join(", ") : undefined,
      picked: topicValueSubjects.length > 0,
      iconPath: new vscode.ThemeIcon(IconNames.VALUE_SUBJECT),
    },
  ];

  const selectedItems: vscode.QuickPickItem[] | undefined = await vscode.window.showQuickPick(
    items,
    {
      canPickMany: true,
      title: `Producing to ${topic.name}: Select Schema Kind(s)`,
      placeHolder: "Select which schema kinds to include (none for schemaless JSON)",
      ignoreFocusOut: true,
    },
  );

  const keySchemaSelected: boolean =
    selectedItems?.some((item) => item.label === "Key Schema") ?? false;
  const valueSchemaSelected: boolean =
    selectedItems?.some((item) => item.label === "Value Schema") ?? false;

  // if the user didn't select key/value but a topic subject exists matching the TopicNameStrategy,
  // warn them that they are producing to a topic with an existing schema
  const ignoringKeySchema: boolean = !keySchemaSelected && topicKeySubjects.length > 0;
  const ignoringValueSchema: boolean = !valueSchemaSelected && topicValueSubjects.length > 0;
  if (ignoringKeySchema || ignoringValueSchema) {
    const ignoredSchemas: string[] = [];
    if (ignoringKeySchema) ignoredSchemas.push(...topicKeySubjectNames);
    if (ignoringValueSchema) ignoredSchemas.push(...topicValueSubjectNames);
    const plural: string = ignoredSchemas.length > 1 ? "s" : "";
    const ignoredSchemasString: string = ignoredSchemas.join(", ");
    const yesButton = "Produce without schema(s)";
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to produce to ${topic.name} without a schema?`,
      {
        modal: true,
        detail: `The following schema${plural} already exist${plural ? "" : "s"} for this topic: ${ignoredSchemasString}`,
      },
      yesButton,
      // "Cancel" is added by default
    );
    if (confirmation !== yesButton) {
      logUsage(UserEvent.MessageProduceAction, {
        status: "exited from key/value schema warning",
        keySchemaSelected,
        valueSchemaSelected,
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
      topicHasKeySchema: topicKeySubjects.length > 0,
      topicHasValueSchema: topicValueSubjects.length > 0,
    });
  } else {
    logUsage(UserEvent.MessageProduceAction, {
      status: "selected produce with schema(s)",
      keySchemaSelected,
      valueSchemaSelected,
      topicHasKeySchema: topicKeySubjects.length > 0,
      topicHasValueSchema: topicValueSubjects.length > 0,
    });
  }

  return { keySchema: keySchemaSelected, valueSchema: valueSchemaSelected };
}

/** Extension of {@link vscode.QuickPickItem} to include the {@link SubjectNameStrategy} as `strategy`. */
type StrategyQuickPickItem = vscode.QuickPickItem & {
  strategy: SubjectNameStrategy;
};

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

  const items: (vscode.QuickPickItem | StrategyQuickPickItem)[] = [
    {
      label: "TopicNameStrategy",
      strategy: SubjectNameStrategy.TOPIC_NAME,
      description: `${topic.name}-${kind} (default)`,
    },
    {
      label: "TopicRecordNameStrategy",
      strategy: SubjectNameStrategy.TOPIC_RECORD_NAME,
      description: `${topic.name}-<fully-qualified record name>`,
    },
    {
      label: "RecordNameStrategy",
      strategy: SubjectNameStrategy.RECORD_NAME,
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

  const selectedItem = await vscode.window.showQuickPick(items, {
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

  return (selectedItem as StrategyQuickPickItem).strategy;
}
