import { workspace, WorkspaceConfiguration } from "vscode";
import { ALLOW_OLDER_SCHEMA_VERSIONS } from "../../extensionSettings/constants";
import { ResourceLoader } from "../../loaders";
import { Schema } from "../../models/schema";
import { SchemaRegistry } from "../../models/schemaRegistry";
import { KafkaTopic } from "../../models/topic";
import { showErrorNotificationWithButtons } from "../../notifications";
import { SubjectNameStrategy } from "../../schemas/produceMessageSchema";
import { schemaVersionQuickPick } from "../schemas";
import { getSubjectNameForStrategy } from "./schemaSubjects";

/**
 * Prompt the user to select a schema subject+version to use when producing messages to a topic.
 *
 * @param topic The Kafka topic to produce messages to
 * @param kind Whether this is for a 'key' or 'value' schema
 * @param strategy The subject name strategy to use to determine the schema subject
 *
 * @returns The selected {@link Schema}, or `undefined` if user cancelled
 */
export async function promptForSchema(
  topic: KafkaTopic,
  kind: "key" | "value",
  strategy: SubjectNameStrategy,
): Promise<Schema> {
  // look up the associated SR instance for this topic
  const loader = ResourceLoader.getInstance(topic.connectionId);
  const schemaRegistries: SchemaRegistry[] = await loader.getSchemaRegistries();
  const registry: SchemaRegistry | undefined = schemaRegistries.find(
    (registry) => registry.environmentId === topic.environmentId,
  );
  if (!registry) {
    const noRegistryMsg = `No Schema Registry available for topic "${topic.name}".`;
    showErrorNotificationWithButtons(noRegistryMsg);
    throw new Error(noRegistryMsg);
  }

  // return the associated schema subject for the given topic if using TopicNameStrategy, otherwise
  // prompt the user for which subject to use
  let schemaSubject: string | undefined = await getSubjectNameForStrategy(
    strategy,
    topic,
    kind,
    registry,
    loader,
  );
  if (!schemaSubject) {
    throw new Error(`"${kind}" schema subject not found/set for topic "${topic.name}".`);
  }

  // show the user a quickpick of schema versions for the given subject if the user has not disabled
  // the option to use older schema versions
  const config: WorkspaceConfiguration = workspace.getConfiguration();
  const allowOlderSchemaVersions: boolean = config.get(ALLOW_OLDER_SCHEMA_VERSIONS, false);
  if (allowOlderSchemaVersions) {
    const schemaVersion: Schema | undefined = await schemaVersionQuickPick(registry, schemaSubject);
    if (!schemaVersion) {
      throw new Error("Schema version not chosen.");
    }
    return schemaVersion;
  }

  // look up the latest schema version for the given subject
  const schemaVersions: Schema[] = await loader.getSchemasForSubject(
    registry.environmentId,
    schemaSubject,
  );
  const latestSchema: Schema | undefined =
    (schemaVersions && schemaVersions.length > 0 && schemaVersions[0]) || undefined;
  if (!latestSchema) {
    const noVersionsMsg = `No schema versions found for subject "${schemaSubject}".`;
    showErrorNotificationWithButtons(noVersionsMsg);
    throw new Error(noVersionsMsg);
  }
  return latestSchema;
}
