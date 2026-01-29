import { createHash } from "crypto";
import { toKafkaTopicOperations } from "../../authz/types";
import type { TopicData } from "../../clients/kafkaRest";
import { TokenManager } from "../../auth/oauth2/tokenManager";
import { ConnectionType, CredentialType } from "../../connections";
import type { IFlinkStatementSubmitParameters } from "../../flinkSql/statementUtils";
import { Logger } from "../../logging";
import type { CCloudKafkaCluster, KafkaCluster } from "../../models/kafkaCluster";
import { isCCloud } from "../../models/resource";
import { Schema, SchemaType, Subject, subjectMatchesTopicName } from "../../models/schema";
import type { SchemaRegistry } from "../../models/schemaRegistry";
import { KafkaTopic } from "../../models/topic";
import type { AuthConfig } from "../../proxy/httpClient";
import { HttpError } from "../../proxy/httpClient";
import * as schemaRegistryProxy from "../../proxy/schemaRegistryProxy";
import * as kafkaRestProxy from "../../proxy/kafkaRestProxy";
import { getResourceManager } from "../../storage/resourceManager";
import { executeInWorkerPool, extract } from "../../utils/workerPool";
import {
  containsPrivateNetworkPattern,
  showPrivateNetworkingHelpNotification,
} from "../../utils/privateNetworking";

const logger = new Logger("loaderUtils");

/**
 * Internal functions used by ResourceLoaders.
 */

export class TopicFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicFetchError";
  }
}

/**
 * Deep read and return of all topics in a Kafka cluster.
 */
export async function fetchTopics(cluster: KafkaCluster): Promise<TopicData[]> {
  logger.debug(`fetching topics for ${cluster.connectionType} Kafka cluster ${cluster.id}`);

  if (!cluster.uri) {
    throw new TopicFetchError(`Kafka cluster ${cluster.id} has no REST URI configured`);
  }

  const auth = await getAuthConfigForCluster(cluster);

  // LOCAL clusters use the v2 REST Proxy API (e.g., /topics)
  // CCloud and Direct clusters use the v3 Kafka REST API (e.g., /kafka/v3/clusters/{id}/topics)
  const apiVersion = cluster.connectionType === ConnectionType.Local ? "v2" : "v3";

  const proxy = kafkaRestProxy.createKafkaRestProxy({
    baseUrl: cluster.uri,
    clusterId: cluster.id,
    auth,
    apiVersion,
  });

  try {
    let topics = await proxy.listTopics({
      includeAuthorizedOperations: true,
    });

    logger.debug(
      `fetched ${topics.length} topic(s) for ${cluster.connectionType} Kafka cluster ${cluster.id}`,
    );

    // Sort by name
    if (topics.length > 1) {
      topics.sort((a, b) => a.topic_name.localeCompare(b.topic_name));
    }

    // Exclude "virtual" topics (e.g., Flink views) that have 0 replication factor
    topics = topics.filter((topic) => topic.replication_factor > 0);

    return topics;
  } catch (error) {
    if (error instanceof HttpError) {
      // Check for private networking issues
      if (error.status === 500 && cluster.uri && containsPrivateNetworkPattern(cluster.uri)) {
        showPrivateNetworkingHelpNotification({
          resourceName: cluster.name,
          resourceUrl: cluster.uri,
          resourceType: "Kafka cluster",
        });
        return [];
      }

      throw new TopicFetchError(
        `Failed to fetch topics from cluster ${cluster.id}: ${error.status} ${error.message}`,
      );
    }

    throw new TopicFetchError(
      `Failed to fetch topics from cluster ${cluster.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Convert an array of {@link TopicData} to an array of {@link KafkaTopic}
 * and set whether or not each topic has a matching schema by subject.
 */
export function correlateTopicsWithSchemaSubjects(
  cluster: KafkaCluster,
  topicsRespTopics: TopicData[],
  subjects: Subject[],
): KafkaTopic[] {
  const topics: KafkaTopic[] = topicsRespTopics.map((topic) => {
    const matchingSubjects: Subject[] = subjects.filter((subject) =>
      subjectMatchesTopicName(subject.name, topic.topic_name),
    );

    // A topic can be queried by Flink if is a CCloud topic and its cluster is "Flinkable."
    let isFlinkable = false;
    if (isCCloud(cluster)) {
      isFlinkable = (cluster as CCloudKafkaCluster).isFlinkable();
    }

    return new KafkaTopic({
      connectionId: cluster.connectionId,
      connectionType: cluster.connectionType,
      name: topic.topic_name,
      is_internal: topic.is_internal,
      replication_factor: topic.replication_factor,
      partition_count: topic.partitions_count,
      partitions: topic.partitions,
      configs: topic.configs,
      clusterId: cluster.id,
      environmentId: cluster.environmentId,
      isFlinkable: isFlinkable,
      operations: toKafkaTopicOperations(topic.authorized_operations!),
      children: matchingSubjects,
    });
  });

  return topics;
}

/**
 * Fetch all of the subjects in the schema registry and return them as an array of sorted Subject objects.
 * Does not store into the resource manager.
 */
export async function fetchSubjects(schemaRegistry: SchemaRegistry): Promise<Subject[]> {
  logger.debug(`fetching subjects from Schema Registry ${schemaRegistry.id}`);

  const auth = await getAuthConfigForSchemaRegistry(schemaRegistry);
  const proxy = schemaRegistryProxy.createSchemaRegistryProxy({
    baseUrl: schemaRegistry.uri,
    auth,
  });

  const subjectStrings = await proxy.listSubjects();
  subjectStrings.sort((a, b) => a.localeCompare(b));

  logger.debug(
    `fetched ${subjectStrings.length} subject(s) from Schema Registry ${schemaRegistry.id}`,
  );

  // Convert to Subject objects
  const subjects: Subject[] = subjectStrings.map(
    (name) =>
      new Subject(
        name,
        schemaRegistry.connectionId,
        schemaRegistry.environmentId,
        schemaRegistry.id,
      ),
  );

  return subjects;
}

/**
 * Given a schema registry and a subject, fetch the versions available, then fetch the details
 * of each version and return them as an array of {@link Schema}.
 *
 * The returned array of schema metadata concerning a a single subject is called a "subject group".
 *
 * @returns An array of all the schemas for the subject in the schema registry, sorted descending by version.
 */
export async function fetchSchemasForSubject(
  schemaRegistry: SchemaRegistry,
  subject: string,
): Promise<Schema[]> {
  logger.debug(`fetching schemas for subject ${subject} from Schema Registry ${schemaRegistry.id}`);

  const auth = await getAuthConfigForSchemaRegistry(schemaRegistry);
  const proxy = schemaRegistryProxy.createSchemaRegistryProxy({
    baseUrl: schemaRegistry.uri,
    auth,
  });

  // Get all version numbers first
  const versions = await proxy.listVersions(subject);

  // Sort versions descending (highest first)
  versions.sort((a, b) => b - a);

  const highestVersion = Math.max(...versions);

  // Prepare concurrent requests for each version
  const fetchParams = versions.map((version) => ({
    proxy,
    schemaRegistry,
    subject,
    version,
    highestVersion,
  }));

  // Fetch all versions concurrently, capped at 5 concurrent requests
  const results = await executeInWorkerPool((params) => fetchSchemaVersion(params), fetchParams, {
    maxWorkers: 5,
  });

  // Extract successful results (throws if any failed)
  return extract(results);
}

/** Interface describing a bundle of params needed for call to {@link fetchSchemaVersion} */
interface FetchSchemaVersionParams {
  proxy: ReturnType<typeof schemaRegistryProxy.createSchemaRegistryProxy>;
  schemaRegistry: SchemaRegistry;
  subject: string;
  version: number;
  highestVersion: number;
}

/**
 * Hit the /subjects/{subject}/versions/{version} route, returning a Schema model.
 */
async function fetchSchemaVersion(params: FetchSchemaVersionParams): Promise<Schema> {
  const { proxy, schemaRegistry, subject, version, highestVersion } = params;

  const response = await proxy.getSchemaByVersion(subject, version);

  // Convert to Schema model
  return Schema.create({
    connectionId: schemaRegistry.connectionId,
    connectionType: schemaRegistry.connectionType,
    schemaRegistryId: schemaRegistry.id,
    environmentId: schemaRegistry.environmentId,
    id: response.id!.toString(),
    subject: response.subject!,
    version: response.version!,
    // AVRO doesn't show up in schemaType, defaults to AVRO
    type: (response.schemaType as SchemaType) || SchemaType.Avro,
    isHighestVersion: response.version === highestVersion,
  });
}

/**
 * Get authentication configuration for a Schema Registry based on connection type.
 */
async function getAuthConfigForSchemaRegistry(
  schemaRegistry: SchemaRegistry,
): Promise<AuthConfig | undefined> {
  switch (schemaRegistry.connectionType) {
    case ConnectionType.Ccloud: {
      // CCloud uses bearer token authentication
      const token = (await TokenManager.getInstance().getDataPlaneToken()) || "";
      return {
        type: "bearer",
        token,
      };
    }
    case ConnectionType.Direct: {
      // Direct connections may have credentials stored
      const resourceManager = getResourceManager();
      const spec = await resourceManager.getDirectConnection(schemaRegistry.connectionId);
      if (spec?.schemaRegistry?.credentials) {
        const creds = spec.schemaRegistry.credentials;
        if (creds.type === CredentialType.BASIC) {
          return {
            type: "basic",
            username: creds.username,
            password: creds.password,
          };
        }
        if (creds.type === CredentialType.API_KEY) {
          return {
            type: "basic",
            username: creds.apiKey,
            password: creds.apiSecret,
          };
        }
      }
      return undefined;
    }
    case ConnectionType.Local:
    default:
      // Local connections typically don't require authentication
      return undefined;
  }
}

/**
 * Get authentication configuration for a Kafka cluster based on connection type.
 */
async function getAuthConfigForCluster(cluster: KafkaCluster): Promise<AuthConfig | undefined> {
  switch (cluster.connectionType) {
    case ConnectionType.Ccloud: {
      // CCloud uses bearer token authentication
      const token = (await TokenManager.getInstance().getDataPlaneToken()) || "";
      return {
        type: "bearer",
        token,
      };
    }
    case ConnectionType.Direct: {
      // Direct connections may have credentials stored
      const resourceManager = getResourceManager();
      const spec = await resourceManager.getDirectConnection(cluster.connectionId);
      if (spec?.kafkaCluster?.credentials) {
        const creds = spec.kafkaCluster.credentials;
        if (creds.type === CredentialType.BASIC) {
          return {
            type: "basic",
            username: creds.username,
            password: creds.password,
          };
        }
        if (creds.type === CredentialType.API_KEY) {
          return {
            type: "basic",
            username: creds.apiKey,
            password: creds.apiSecret,
          };
        }
      }
      return undefined;
    }
    case ConnectionType.Local:
    default:
      // Local connections typically don't require authentication
      return undefined;
  }
}

/** Generate a key for the given statement parameters to identify identical pending statements. */
export function generateFlinkStatementKey(params: IFlinkStatementSubmitParameters): string {
  // Compute MD5 hash of:
  // 1. Compute pool id
  // 2. Database name (may be empty)
  // 3. The catalog name (may be empty)
  // 4. SQL statement text

  // NOSONAR: We don't use a cryptographically secure hash here, we just want a
  // fingerprint to avoid duplicate identical statements in flight.
  const hasher = createHash("md5");

  hasher.update(params.computePool.id);
  hasher.update(params.properties.currentDatabase || ""); // database may be empty
  hasher.update(params.properties.currentCatalog || ""); // catalog may be empty
  hasher.update(params.statement);
  return hasher.digest("hex");
}
