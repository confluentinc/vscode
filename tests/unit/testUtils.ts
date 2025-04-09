import * as vscode from "vscode";
import { KafkaTopicOperation } from "../../src/authz/types";
import { TopicData, TopicDataFromJSON } from "../../src/clients/kafkaRest/models";
import { EXTENSION_ID } from "../../src/constants";
import { setExtensionContext } from "../../src/context/extension";
import { Subject } from "../../src/models/schema";
import { SchemaRegistry } from "../../src/models/schemaRegistry";
import { StorageManager } from "../../src/storage";

/**
 * Convenience function to get the extension.
 * @remarks This does not activate the extension, so the {@link vscode.ExtensionContext} will not be
 * available. Use {@link getAndActivateExtension} to activate the extension, or
 * {@link getTestExtensionContext} to get the context directly.
 * @param id The extension ID to get. Defaults to the Confluent extension.
 * @returns A {@link vscode.Extension} instance.
 */
export async function getExtension(id: string = EXTENSION_ID): Promise<vscode.Extension<any>> {
  const extension = vscode.extensions.getExtension(id);
  if (!extension) {
    throw new Error(`Extension with ID "${id}" not found`);
  }
  return extension;
}

/**
 * Convenience function to get and activate the extension.
 * @param id The extension ID to activate. Defaults to the Confluent extension.
 * @returns A {@link vscode.Extension} instance.
 */
export async function getAndActivateExtension(
  id: string = EXTENSION_ID,
): Promise<vscode.Extension<any>> {
  const extension = await getExtension(id);
  if (!extension.isActive) {
    console.info(`Activating extension: ${id}`);
    await extension.activate();
  } else {
    console.info(`Extension already activated: ${id}`);
  }
  return extension;
}

/**
 * Convenience function to get the extension context for testing.
 * @returns A {@link vscode.ExtensionContext} instance.
 */
export async function getTestExtensionContext(
  id: string = EXTENSION_ID,
): Promise<vscode.ExtensionContext> {
  const extension = await getAndActivateExtension(id);
  // this only works because we explicitly return the ExtensionContext in our activate() function
  const context = extension.exports;
  setExtensionContext(context);
  return context;
}

export async function getTestStorageManager(): Promise<StorageManager> {
  // the extension needs to be activated before we can use the StorageManager
  await getTestExtensionContext();
  return StorageManager.getInstance();
}

/** Create a Kafka TopicData instance, as if from a REST response. */
export function createTestTopicData(
  clusterId: string,
  topicName: string,
  authorizedOperations: KafkaTopicOperation[],
): TopicData {
  return TopicDataFromJSON({
    kind: "KafkaTopic",
    metadata: {
      self: "test",
    },
    cluster_id: clusterId,
    topic_name: topicName,
    is_internal: false,
    replication_factor: 1,
    partitions_count: 3,
    partitions: {
      related: "test",
    },
    partition_reassignments: {
      related: "test",
    },
    configs: {
      related: "test",
    },
    authorized_operations: authorizedOperations,
  });
}

/** Create test suite Subject objects for use in tests. */
export function createTestSubject(schemaRegistry: SchemaRegistry, name: string): Subject {
  return new Subject(
    name,
    schemaRegistry.connectionId,
    schemaRegistry.environmentId,
    schemaRegistry.id,
  );
}
