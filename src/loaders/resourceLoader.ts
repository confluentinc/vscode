import { Disposable } from "vscode";
import { TopicData } from "../clients/kafkaRest";
import { DeleteSchemaVersionRequest } from "../clients/schemaRegistryRest";
import { ConnectionType } from "../clients/sidecar";
import { logError } from "../errors";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { KafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId, IResourceBase } from "../models/resource";
import { Schema, Subject, subjectMatchesTopicName, SubjectWithSchemas } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";
import {
  correlateTopicsWithSchemaSubjects,
  fetchSchemasForSubject,
  fetchSubjects,
  fetchTopics,
} from "./loaderUtils";

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

    return correlateTopicsWithSchemaSubjects(cluster, responseTopics, subjects);
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
    forceRefresh: boolean = false,
  ): Promise<Subject[]> {
    try {
      const schemaRegistry = await this.resolveSchemaRegistry(registryOrEnvironmentId);
      const resourceManager = getResourceManager();
      if (!forceRefresh) {
        // cache allowed ...
        const subjects = await resourceManager.getSubjects(schemaRegistry);
        if (subjects) {
          // and was either an empty or non-empty array --- just not undefined.
          return subjects;
        }
      }

      // Undefined cache lookup result or was forced to refresh ...

      // Deep fetch the subjects from the schema registry, cache, return.
      const subjects = await fetchSubjects(schemaRegistry);
      await resourceManager.setSubjects(schemaRegistry, subjects);
      return subjects;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.match(/No schema registry found for environment/)
      ) {
        // Expected error when no schema registry found for the environment.
        // Act as if there are no subjects / schemas.
        return [];
      } else {
        // Unexpected error, log it to sentry.
        logError(
          error,
          "Unexpected error within getSubjects",
          { registryOrEnvironmentId: JSON.stringify(registryOrEnvironmentId, null, 2) },
          true,
        );
      }
      throw error;
    }
  }

  /**
   * Get the list of schema (metadata) for a single subject from a schema registry.
   *
   * Currently does not cache. Used to, hence the forceRefresh parameter, and may well again one day.
   * Keeping the parameter for now so won't have to find the right places to add it back in.
   */
  public async getSchemasForSubject(
    registryOrEnvironmentId: SchemaRegistry | EnvironmentId,
    subject: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    forceRefresh: boolean = false,
  ): Promise<Schema[]> {
    const schemaRegistry = await this.resolveSchemaRegistry(registryOrEnvironmentId);
    return fetchSchemasForSubject(schemaRegistry, subject);
  }

  /**
   * Get the subjects with corresponding schemas for a single Kafka topic.
   *
   * The subjects will have their `.schemas` property populated, and will be in alphabetical order.
   * If the topic has no corresponding subjects, an empty array is returned.
   * Implemented atop {@link getSubjects}, {@link getSchemasForSubject}.
   *
   * @param topic The Kafka topic to load schemas for. If not from the same connection as this loader, an error is thrown.
   * @returns An array of {@link Subject} objects representing the topic's schemas, grouped
   * by subject as {@link Schema}s, with the {@link Schema}s in version-descending order.
   *
   * @see https://developer.confluent.io/courses/schema-registry/schema-subjects/#subject-name-strategies
   */
  public async getTopicSubjectGroups(topic: KafkaTopic): Promise<Subject[]> {
    if (topic.connectionId !== this.connectionId) {
      throw new Error(
        `Mismatched connectionId ${this.connectionId} for topic ${topic.name} (${topic.connectionId})`,
      );
    }

    /*
      1. Get all the subjects from the topic's cluster's environment's schema registry.
      2. Filter by those corresponding to the topic in question. Will usually get one or two subjects.
      3. For each of those subjects, get the corresponding array of schema versions.
      4. Assemble each subject + schemas array into an array of Subject holding its own schemas.
      5. Return said array.
    */

    // 1. Get all the subjects from the topic's cluster's environment's schema registry.

    // (Because this gets called many times in the lifetime of a connection, it is imperative that the subject
    //  list is cached in the loader regardless of loader implemenation, issue #1051)
    const subjects = await this.getSubjects(topic.environmentId);

    // 2. Filter by those corresponding to the topic in question. Will usually get one or two subjects.
    const schemaSubjects = subjects.filter((subject) =>
      subjectMatchesTopicName(subject.name, topic.name),
    );

    if (!schemaSubjects.length) {
      return [];
    }

    // 3. For each of those subjects, get the corresponding schema version array.
    // Load all the schema versions for each subject in the matching subjects
    // concurrently.
    const subjectGroupRequests = schemaSubjects.map((subject) =>
      this.getSchemasForSubject(topic.environmentId, subject.name),
    );
    const subjectGroups = await Promise.all(subjectGroupRequests);

    // 4. Group by each subject: a Subject carrying the schemas, collect into an array thereof.
    const schemaContainers: Subject[] = subjectGroups.map((group: Schema[]) => {
      const firstSchema = group[0];

      // Roll this Schema[] into a Subject object with a Schema[] payload.
      // (This is the only place in the codebase where a Subject is created with a Schema[] payload.)
      return new Subject(
        firstSchema.subject,
        topic.connectionId,
        topic.environmentId,
        firstSchema.schemaRegistryId,
        group,
      );
    });

    // Sort by subject name.
    schemaContainers.sort((a, b) => a.name.localeCompare(b.name));

    // 5. Return said array.
    return schemaContainers;
  }

  /**
   * Delete a schema version from the schema registry.
   *
   * Will take care of clearing any ResourceLoader cache clearing as needed, but
   * does not fire off any events.
   *
   * @param schema The Schema/version to delete.
   * @param hardDelete Should this be a hard delete?
   * @param shouldClearSubject Hint as to whether the caller should clear the subject cache,
   *                  as when it was known that this was the last version of the subject.
   */
  public async deleteSchemaVersion(
    schema: Schema,
    hardDelete: boolean,
    shouldClearSubject: boolean,
  ): Promise<void> {
    const subjectApi = (await getSidecar()).getSubjectsV1Api(
      schema.schemaRegistryId,
      schema.connectionId,
    );

    try {
      if (hardDelete) {
        // Must do a soft delete first, then hard delete.
        const softDeleteRequest: DeleteSchemaVersionRequest = {
          subject: schema.subject,
          version: `${schema.version}`,
          permanent: false,
        };

        // first the soft delete
        await subjectApi.deleteSchemaVersion(softDeleteRequest);
      }

      // Now can perform either a hard or a soft delete.
      const deleteRequest: DeleteSchemaVersionRequest = {
        subject: schema.subject,
        version: `${schema.version}`,
        permanent: hardDelete,
      };

      await subjectApi.deleteSchemaVersion(deleteRequest);
    } catch (error) {
      logError(
        error,
        "Error deleting schema version",
        {
          connectionId: schema.connectionId,
          environmentId: schema.environmentId ? schema.environmentId : "unknown",
          schemaRegistryId: schema.schemaRegistryId,
          hardDelete: hardDelete ? "true" : "false",
        },
        true,
      );
      throw error;
    }

    if (shouldClearSubject) {
      // Clear out the cache for the whole of the schema registry, which
      // right now is just the subjects.
      const schemaRegistry = await this.getSchemaRegistryForEnvironmentId(schema.environmentId);
      if (schemaRegistry) {
        await this.clearCache(schemaRegistry);
      }
    }
  }

  /**
   *
   * @param subject The subject to delete. Must carry all of the schema versions to delete within its `.schemas` property.
   * @param hardDelete Should each schema version be hard deleted?
   */
  public async deleteSchemaSubject(
    subject: SubjectWithSchemas,
    hardDelete: boolean,
  ): Promise<void> {
    // Loop over schemas within the subject, calling deleteSchemaVersion on each schema.
    // The final call, set shouldClearSubject to true, will clear the subject cache.

    logger.info(`Deleting ${subject.schemas.length} schema versions for subject ${subject.name}`);
    const schemaGroup: Schema[] = subject.schemas;
    for (let i: number = 0; i < schemaGroup.length; i++) {
      const schema: Schema = schemaGroup[i];
      const shouldClearSubject: boolean = i === schemaGroup.length - 1;
      await this.deleteSchemaVersion(schema, hardDelete, shouldClearSubject);
      logger.info(`Deleted schema version ${schema.version} for subject ${subject.name}`);
    }

    logger.info("Checking for lingering schemas after deleteSchemaSubject");

    // Ensure no remaining versions.
    // Call to getSchemasForSubject() will raise 404 error if the subject is gone.
    let lingeringSchemas: Schema[] | undefined;

    try {
      lingeringSchemas = await this.getSchemasForSubject(
        subject.environmentId,
        subject.name,
        true, // forceRefresh
      );
    } catch (e: any) {
      // XXX todo put this in common placve to identify 404s.
      if (e.name === "ResponseError") {
        if (e.response.status === 404) {
          // Expected error when the subject is deleted. This is our happy path.
          return;
        }
      }

      // anything else, raise.
      logError(
        e,
        "Unexpected error within deleteSchemaSubject",
        {
          connectionId: subject.connectionId,
          environmentId: subject.environmentId,
          schemaRegistryId: subject.schemaRegistryId,
        },
        true,
      );
      throw e;
    }
    // If we get here, the subject is still present and we still have some schema versions(!!)

    if (lingeringSchemas.length) {
      throw new Error(
        `Expected no schemas to be present after deleting subject ${subject.name}, but found ${lingeringSchemas.length}`,
      );
    }
  }

  /**
   * General preemptive cache clearing.
   * Clear whatever data may be cached scoped to the given object. Used when
   * a subordinate resource is known to be modified in some way.
   *
   * Limited type support right now, but expected to grow over time.
   *
   * @param resource The resource to clear the storage cache for.
   **/
  public async clearCache(resource: SchemaRegistry): Promise<void> {
    if (resource.connectionId !== this.connectionId) {
      throw new Error(`Mismatched connectionId ${this.connectionId} for resource ${resource.id}`);
    }

    // Clear out cached subjects, if any.
    logger.debug(`Clearing subject cache for schema registry ${resource.id}`);
    const resourceManager = getResourceManager();
    await resourceManager.setSubjects(resource, undefined);
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
}
