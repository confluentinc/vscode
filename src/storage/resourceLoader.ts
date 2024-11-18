import { Require } from "dataclass";
import { Disposable } from "vscode";
import { toKafkaTopicOperations } from "../authz/types";
import { ResponseError, TopicData, TopicDataList, TopicV3Api } from "../clients/kafkaRest";
import { Schema as ResponseSchema, SchemasV1Api } from "../clients/schemaRegistryRest";
import { Environment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { Schema, SchemaType } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";

/** Human readable characterization of the backing technology resources were loaded from */
export enum ResourceLoaderType {
  CCloud = "Confluent Cloud",
  Local = "Local",
}

/**
 * Class family for dealing with loading (and perhaps caching) information
 * about resources (kafka clusters, schema registries, etc). View providers
 * or quickpicks or other consumers of resources should go through this
 * API to make things simple and consistent across CCloud, local, or direct
 * connection clusters.
 */
export abstract class ResourceLoader {
  /**
   * What kind of resources does this loader manage? Human readable string, often
   * used by quickpick separator labels.
   */
  public abstract kind: ResourceLoaderType;

  /** Disposables belonging to all instances of ResourceLoader to be added to the extension
   * context during activation, cleaned up on extension deactivation.
   * TODO: Reconsider when we have less-permanant direct connections also.
   */
  protected static disposables: Disposable[] = [];

  /**  Return all known long lived disposables for extension cleanup. */
  public static getDisposables(): Disposable[] {
    return ResourceLoader.disposables;
  }

  // Map of connectionId to ResourceLoader instance.
  private static registry: Map<string, ResourceLoader> = new Map();

  public static registerInstance(connectionId: string, loader: ResourceLoader): void {
    ResourceLoader.registry.set(connectionId, loader);
  }

  /** Get the ResourceLoader subclass instance corresponding to the given connectionId */
  public static getInstance(connectionId: string): ResourceLoader {
    const loader = ResourceLoader.registry.get(connectionId);
    if (loader) {
      return loader;
    }

    throw new Error(`Unknown connectionId ${connectionId}`);
  }

  // Environment methods

  /**
   * Get the accessible environments from the connection.
   * @param forceDeepRefresh Ignore any previously cached resources and fetch anew?
   */
  public abstract getEnvironments(forceDeepRefresh?: boolean): Promise<Environment[]>;

  // Kafka cluster methods

  /**
   * Get the kafka clusters in the given environment.
   */
  public abstract getKafkaClustersForEnvironmentId(
    environmentId: string,
    forceDeepRefresh?: boolean,
  ): Promise<KafkaCluster[]>;

  /**
   * Return the topics present in the cluster. Will also correlate with schemas
   * in the schema registry for the cluster, if any.
   */
  public abstract getTopicsForCluster(
    cluster: KafkaCluster,
    forceDeepRefresh?: boolean,
  ): Promise<KafkaTopic[]>;

  // Schema registry methods

  /**
   * Get all schema registries known to the connection. Optionally accepts an existing SidecarHandle
   * to use if need be if provided.
   */
  public abstract getSchemaRegistries(): Promise<SchemaRegistry[]>;

  /**
   * Return the appropriate schema registry to use, if any, for the given object's environment.
   * @param environmentable The {@link EnvironmentResource} to get the corresponding schema registry for.
   * @returns The {@link SchemaRegistry} for the resource's environment, if any.
   */
  public abstract getSchemaRegistryForEnvironmentId(
    environmentId: string | undefined,
  ): Promise<SchemaRegistry | undefined>;

  /**
   * Get the possible schemas for an environment's schema registry.
   *
   * @param environmentable The {@link EnvironmentResource} to get the corresponding schema registry's
   * schemas from. Will return empty array if there is no schema registry for the environment,
   * or if said schema registry has no schemas.
   */
  public async getSchemasForEnvironmentId(
    environmentId: string | undefined,
    forceDeepRefresh: boolean = false,
  ): Promise<Schema[]> {
    const schemaRegistry = await this.getSchemaRegistryForEnvironmentId(environmentId);
    if (!schemaRegistry) {
      return [];
    }

    return await this.getSchemasForRegistry(schemaRegistry, forceDeepRefresh);
  }

  /**
   * Fetch the schemas from the given schema registry.
   * @param schemaRegistry The schema registry to fetch schemas from.
   * @param forceDeepRefresh If true, will ignore any cached schemas and fetch anew.
   * @returns An array of schemas in the schema registry. Throws an error if the schemas could not be fetched.
   * */
  public abstract getSchemasForRegistry(
    schemaRegistry: SchemaRegistry,
    forceDeepRefresh?: boolean,
  ): Promise<Schema[]>;

  /**
   * Indicate to purge this schema registry's cache of schemas, if the
   * loader implementation caches.
   * This is useful when a schema is known to has been added or removed, but the
   * registry isn't currently being displayed in the view.
   * (So that when it does get displayed, it will fetch the schemas anew).
   */
  public abstract purgeSchemas(schemaRegistryId: string): void;
}

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
  const sidecar = await getSidecar();
  const client: TopicV3Api = sidecar.getTopicV3Api(cluster.id, cluster.connectionId);
  let topicsResp: TopicDataList;

  try {
    topicsResp = await client.listKafkaTopics({
      cluster_id: cluster.id,
      includeAuthorizedOperations: true,
    });
  } catch (error) {
    if (error instanceof ResponseError) {
      // XXX todo improve this, raise a more specific error type.
      const body = await error.response.json();

      throw new TopicFetchError(JSON.stringify(body));
    } else {
      throw new TopicFetchError(JSON.stringify(error));
    }
  }

  return topicsResp.data;
}

/**
 * Convert an array of {@link TopicData} to an array of {@link KafkaTopic}
 * and set whether or not each topic has a matching schema.
 */
export function correlateTopicsWithSchemas(
  cluster: KafkaCluster,
  topicsRespTopics: TopicData[],
  schemas: Schema[],
): KafkaTopic[] {
  const topics: KafkaTopic[] = topicsRespTopics.map((topic) => {
    const hasMatchingSchema: boolean = schemas.some((schema) =>
      schema.matchesTopicName(topic.topic_name),
    );

    return KafkaTopic.create({
      name: topic.topic_name,
      is_internal: topic.is_internal,
      replication_factor: topic.replication_factor,
      partition_count: topic.partitions_count,
      partitions: topic.partitions,
      configs: topic.configs,
      clusterId: cluster.id,
      environmentId: cluster instanceof CCloudKafkaCluster ? cluster.environmentId : undefined,
      hasSchema: hasMatchingSchema,
      operations: toKafkaTopicOperations(topic.authorized_operations!),
    });
  });

  return topics;
}

/**
 * Deep read and return of all schemas in a CCloud or local environment's Schema Registry.
 * Does not store into the resource manager.
 *
 * @param schemaRegistryId The Schema Registry ID to fetch schemas from (within the environment).
 * @param connectionId The connection ID to use to fetch schemas.
 * @param environmentId Optional: the CCloud environment ID to associate CCloud schemas with.
 * @returns An array of all the schemas in the environment's Schema Registry.
 */
export async function fetchSchemas(
  schemaRegistryId: string,
  connectionId: string,
  environmentId: string | undefined = undefined,
): Promise<Schema[]> {
  const sidecarHandle = await getSidecar();
  const client: SchemasV1Api = sidecarHandle.getSchemasV1Api(schemaRegistryId, connectionId);
  const schemaListRespData: ResponseSchema[] = await client.getSchemas();
  const schemas: Schema[] = schemaListRespData.map((schema: ResponseSchema) => {
    // AVRO doesn't show up in `schemaType`
    // https://docs.confluent.io/platform/current/schema-registry/develop/api.html#get--subjects-(string-%20subject)-versions-(versionId-%20version)
    const schemaType = (schema.schemaType as SchemaType) || SchemaType.Avro;
    // appease typescript because it doesn't want to convert `string | undefined` to `Require<string> | undefined`
    const maybeEnvironmentId = environmentId as Require<string | undefined>;
    // casting `id` from number to string to allow returning Schema types in `.getChildren()` above
    return Schema.create({
      id: schema.id!.toString(),
      subject: schema.subject!,
      version: schema.version!,
      type: schemaType,
      schemaRegistryId: schemaRegistryId,
      environmentId: maybeEnvironmentId,
    });
  });
  return schemas;
}
