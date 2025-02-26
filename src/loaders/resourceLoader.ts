import { Disposable } from "vscode";
import { TopicData } from "../clients/kafkaRest";
import { ConnectionType } from "../clients/sidecar";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { KafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId, IResourceBase } from "../models/resource";
import { Schema, Subject } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import {
  correlateTopicsWithSchemaSubjects,
  fetchSchemaSubjectGroup,
  fetchSubjects,
  fetchTopics,
} from "./loaderUtils";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = new Logger("resourceLoader");

/**
 * Class family for dealing with loading (and perhaps caching) information
 * about resources (kafka clusters, schema registries, etc). View providers
 * or quickpicks or other consumers of resources should go through this
 * API to make things simple and consistent across CCloud, local, or direct
 * connection clusters.
 */
export abstract class ResourceLoader implements IResourceBase {
  /** The connectionId for this resource loader. */
  public abstract connectionId: ConnectionId;
  /** The parent connectionType for this resource loader. */
  public abstract connectionType: ConnectionType;

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
  private static registry: Map<ConnectionId, ResourceLoader> = new Map();

  public static registerInstance(connectionId: ConnectionId, loader: ResourceLoader): void {
    ResourceLoader.registry.set(connectionId, loader);
  }

  public static deregisterInstance(connectionId: ConnectionId): void {
    ResourceLoader.registry.delete(connectionId);
  }

  static loaders(): ResourceLoader[] {
    return Array.from(ResourceLoader.registry.values());
  }

  /** Get the ResourceLoader subclass instance corresponding to the given connectionId */
  public static getInstance(connectionId: ConnectionId): ResourceLoader {
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
   * Return the topics present in the cluster, annotated with whether or not
   * they have a corresponding schema subject.
   */
  public async getTopicsForCluster(
    cluster: KafkaCluster,
    forceRefresh: boolean = false,
  ): Promise<KafkaTopic[]> {
    // Deep fetch the topics and schema registry subject names concurrently.
    const [subjects, responseTopics]: [Subject[], TopicData[]] = await Promise.all([
      this.getSubjects(cluster.environmentId!, forceRefresh),
      fetchTopics(cluster),
    ]);

    return correlateTopicsWithSchemaSubjects(
      cluster,
      responseTopics,
      // erode Subject[] to just string[]
      subjects.map((s) => s.name),
    );
  }

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
   * Get the subjects from the schema registry for the given environment or schema registry.
   * @param environmentId The environment to get the schema registry's subjects from.
   * @param forceDeepRefresh If true, will ignore any cached subjects and fetch anew.
   * @returns An array of subjects in the schema registry. Throws an error if the subjects could not be fetched.
   * */
  public async getSubjects(
    registryOrEnvironmentId: SchemaRegistry | EnvironmentId,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    forceRefresh: boolean = false,
  ): Promise<Subject[]> {
    try {
      const schemaRegistry = await this.resolveSchemaRegistry(registryOrEnvironmentId);
      return await fetchSubjects(schemaRegistry);
    } catch (error) {
      logger.error("Error fetching subjects", error);
      if (
        error instanceof Error &&
        error.message.match(/No schema registry found for environment/)
      ) {
        // Expected error when no schema registry found for the environment.
        // Act as if there are no subjects / schemas.
        return [];
      }
      throw error;
    }
  }

  /**
   * Get the list of schema (metadata) for a single subject group from a schema registry.
   */
  public async getSchemaSubjectGroup(
    registryOrEnvironmentId: SchemaRegistry | EnvironmentId,
    subject: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    forceRefresh: boolean = false,
  ): Promise<Schema[]> {
    const schemaRegistry = await this.resolveSchemaRegistry(registryOrEnvironmentId);
    return fetchSchemaSubjectGroup(schemaRegistry, subject);
  }

  /**
   * Distill a possible environment id into its corresponding schema registry.
   * Validate that the registry belongs to the same connection as this loader.
   */
  private async resolveSchemaRegistry(
    registryOrEnvironmentId: SchemaRegistry | EnvironmentId,
  ): Promise<SchemaRegistry> {
    let schemaRegistry: SchemaRegistry | undefined;
    if (typeof registryOrEnvironmentId === "string") {
      schemaRegistry = await this.getSchemaRegistryForEnvironmentId(registryOrEnvironmentId);
      if (!schemaRegistry) {
        throw new Error(`No schema registry found for environment ${registryOrEnvironmentId}`);
      }
    } else {
      schemaRegistry = registryOrEnvironmentId;
    }

    if (schemaRegistry.connectionId !== this.connectionId) {
      throw new Error(
        `Mismatched connectionId ${this.connectionId} for schema registry ${schemaRegistry.id}`,
      );
    }

    return schemaRegistry;
  }

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
