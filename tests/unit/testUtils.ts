import * as vscode from "vscode";
import type { KafkaTopicOperation } from "../../src/authz/types";
import { ResponseError as DockerResponseError } from "../../src/clients/docker";
import { ResponseError as FlinkArtifactsResponseError } from "../../src/clients/flinkArtifacts";
import { ResponseError as FlinkComputePoolResponseError } from "../../src/clients/flinkComputePool";
import { ResponseError as FlinkSqlResponseError } from "../../src/clients/flinkSql";
import { ResponseError as KafkaResponseError } from "../../src/clients/kafkaRest";
import type { TopicData } from "../../src/clients/kafkaRest/models";
import { TopicDataFromJSON } from "../../src/clients/kafkaRest/models";
import { ResponseError as ScaffoldingServiceResponseError } from "../../src/clients/scaffoldingService";
import { ResponseError as SchemaRegistryResponseError } from "../../src/clients/schemaRegistryRest";
import { ResponseError as SidecarResponseError } from "../../src/clients/sidecar";
import { EXTENSION_ID } from "../../src/constants";
import { setExtensionContext } from "../../src/context/extension";
import type { AnyResponseError } from "../../src/errors";
import { Subject } from "../../src/models/schema";
import type { SchemaRegistry } from "../../src/models/schemaRegistry";

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

export enum ResponseErrorSource {
  Docker = "docker",
  FlinkArtifacts = "flinkArtifacts",
  FlinkComputePool = "flinkComputePool",
  FlinkSql = "flinkSql",
  KafkaRest = "kafkaRest",
  ScaffoldingService = "scaffoldingService",
  SchemaRegistryRest = "schemaRegistryRest",
  Sidecar = "sidecar",
}

/**
 * Create a mock ResponseError for testing.
 * @param status - HTTP status code
 * @param statusText - HTTP status text
 * @param body - Response body
 * @param source - Which {@link ResponseErrorSource client source} ResponseError is returned, defaults to sidecar
 * @returns A ResponseError instance
 */
export function createResponseError(
  status: number,
  statusText: string,
  body: string,
  source: ResponseErrorSource = ResponseErrorSource.Sidecar,
): AnyResponseError {
  const response = {
    status,
    statusText,
    clone: () => ({
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body)),
    }),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as Response;

  // any callers that end up using `isResponseError()` will need to know which client code subdir
  // the error came from, so we need to return the correct subclass of ResponseError
  switch (source) {
    case ResponseErrorSource.Docker:
      return new DockerResponseError(response);
    case ResponseErrorSource.FlinkArtifacts:
      return new FlinkArtifactsResponseError(response);
    case ResponseErrorSource.FlinkComputePool:
      return new FlinkComputePoolResponseError(response);
    case ResponseErrorSource.FlinkSql:
      return new FlinkSqlResponseError(response);
    case ResponseErrorSource.KafkaRest:
      return new KafkaResponseError(response);
    case ResponseErrorSource.ScaffoldingService:
      return new ScaffoldingServiceResponseError(response);
    case ResponseErrorSource.SchemaRegistryRest:
      return new SchemaRegistryResponseError(response);
    case ResponseErrorSource.Sidecar:
      return new SidecarResponseError(response);
    default:
      throw new Error(`Unknown ResponseError source: ${source}`);
  }
}
