import { createHash } from "crypto";
import { toKafkaTopicOperations } from "../../authz/types";
import { TokenManager } from "../../auth/oauth2/tokenManager";
import { ConnectionType, type Credentials } from "../../connections";
import { getCredentialsType } from "../../directConnections/credentials";
import type { IFlinkStatementSubmitParameters } from "../../flinkSql/statementUtils";
import {
  getTopicService,
  KafkaAdminError,
  topicInfoToTopicData,
  type SimpleTopicData,
} from "../../kafka";
import { Logger } from "../../logging";
import type { CCloudKafkaCluster, KafkaCluster } from "../../models/kafkaCluster";
import { isCCloud } from "../../models/resource";
import { Schema, SchemaType, Subject, subjectMatchesTopicName } from "../../models/schema";
import type { SchemaRegistry } from "../../models/schemaRegistry";
import { KafkaTopic } from "../../models/topic";
import type { AuthConfig } from "../../proxy/httpClient";
import * as schemaRegistryProxy from "../../proxy/schemaRegistryProxy";
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
 *
 * Uses the appropriate TopicService implementation based on connection type
 * and runtime environment:
 * - CCloud: REST API (v3 with OAuth)
 * - LOCAL/DIRECT on desktop: kafkajs Admin client
 * - LOCAL/DIRECT on web: REST API fallback (v2 for LOCAL, v3 for DIRECT)
 */
export async function fetchTopics(cluster: KafkaCluster): Promise<SimpleTopicData[]> {
  logger.debug(`fetching topics for ${cluster.connectionType} Kafka cluster ${cluster.id}`);

  const topicService = getTopicService(cluster);

  try {
    const topics = await topicService.listTopics(cluster, {
      includeAuthorizedOperations: true,
      includeInternal: false,
    });

    logger.debug(
      `fetched ${topics.length} topic(s) for ${cluster.connectionType} Kafka cluster ${cluster.id}`,
    );

    // Log authorized operations for debugging
    const firstTopicWithOps = topics.find((t) => t.authorizedOperations?.length);
    if (firstTopicWithOps) {
      logger.debug(
        `sample authorized_operations from topic "${firstTopicWithOps.name}": ${JSON.stringify(firstTopicWithOps.authorizedOperations)}`,
      );
    } else if (topics.length > 0) {
      logger.debug(
        `no authorized_operations returned for any topic (first topic: ${topics[0].name}, ops: ${JSON.stringify(topics[0].authorizedOperations)})`,
      );
    }

    // Convert to TopicData format for compatibility with existing code
    let topicData = topics.map(topicInfoToTopicData);

    // Exclude "virtual" topics (e.g., Flink views) that have 0 replication factor
    topicData = topicData.filter((topic) => (topic.replication_factor ?? 0) > 0);

    return topicData;
  } catch (error) {
    // Handle KafkaAdminError (from kafkajs or wrapped HTTP errors)
    if (error instanceof KafkaAdminError) {
      // Check for private networking issues (typically shows as transient errors)
      // For REST API connections (Local/CCloud), check the URI
      // For Direct connections (native protocol), check the bootstrap servers
      const networkUrl = cluster.uri ?? cluster.bootstrapServers;
      if (containsPrivateNetworkPattern(networkUrl)) {
        showPrivateNetworkingHelpNotification({
          resourceName: cluster.name,
          resourceUrl: networkUrl,
          resourceType: "Kafka cluster",
        });
        return [];
      }

      throw new TopicFetchError(
        `Failed to fetch topics from cluster ${cluster.id}: ${error.message}`,
      );
    }

    throw new TopicFetchError(
      `Failed to fetch topics from cluster ${cluster.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Convert an array of {@link SimpleTopicData} to an array of {@link KafkaTopic}
 * and set whether or not each topic has a matching schema by subject.
 */
export function correlateTopicsWithSchemaSubjects(
  cluster: KafkaCluster,
  topicsRespTopics: SimpleTopicData[],
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
      is_internal: topic.is_internal ?? false,
      replication_factor: topic.replication_factor ?? 0,
      partition_count: topic.partitions_count ?? 0,
      partitions: topic.partitions ?? {},
      configs: topic.configs ?? {},
      clusterId: cluster.id,
      environmentId: cluster.environmentId,
      isFlinkable: isFlinkable,
      operations: toKafkaTopicOperations(topic.authorized_operations ?? []),
      // Only set operationsKnown if auth info was actually returned (not undefined)
      operationsKnown: topic.authorized_operations !== undefined,
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
 * Converts credentials to HTTP Basic auth configuration.
 *
 * Handles both modern credentials (with `type` discriminator) and
 * legacy/imported credentials (without `type`, detected by property names).
 * Also handles both camelCase and snake_case property names.
 *
 * @param credentials The credentials to convert.
 * @returns Basic auth config, or undefined if no auth required.
 */
function credentialsToBasicAuth(credentials: Credentials | undefined): AuthConfig | undefined {
  if (!credentials) {
    return undefined;
  }

  // Detect credential type - handles both modern (with type) and legacy (property-based)
  const authType = getCredentialsType(credentials);
  const creds = credentials as unknown as Record<string, unknown>;

  switch (authType) {
    case "Basic":
      return {
        type: "basic",
        username: (creds.username as string) ?? "",
        password: (creds.password as string) ?? "",
      };
    case "API":
      // API keys are sent as basic auth with key:secret
      // Check both camelCase and snake_case property names
      return {
        type: "basic",
        username: ((creds.apiKey ?? creds.api_key) as string) ?? "",
        password: ((creds.apiSecret ?? creds.api_secret) as string) ?? "",
      };
    case "SCRAM":
      // SCRAM credentials use basic auth transport
      // Check standard, scram-specific, and snake_case variants
      return {
        type: "basic",
        username: ((creds.username ?? creds.scramUsername ?? creds.scram_username) as string) ?? "",
        password: ((creds.password ?? creds.scramPassword ?? creds.scram_password) as string) ?? "",
      };
    case "None":
    default:
      return undefined;
  }
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
        return credentialsToBasicAuth(spec.schemaRegistry.credentials);
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
