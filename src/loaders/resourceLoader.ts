import { Disposable } from "vscode";
import { DeleteSchemaVersionRequest, DeleteSubjectRequest } from "../clients/schemaRegistryRest";
import { ConnectionType } from "../clients/sidecar";
import { isResponseError, logError } from "../errors";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { KafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId, IResourceBase } from "../models/resource";
import { Schema, Subject, subjectMatchesTopicName } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { showWarningNotificationWithButtons } from "../notifications";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";
import { DirectResourceLoader } from "./directResourceLoader";
import { fetchSchemasForSubject, fetchSubjects } from "./loaderUtils";

const logger = new Logger("resourceLoader");

/**
 * Class family for dealing with loading (and perhaps caching) information
 * about resources (kafka clusters, schema registries, etc). View providers
 * or quickpicks or other consumers of resources should go through this
 * API to make things simple and consistent across CCloud, local, or direct
 * connection clusters.
 *
 * Generic class over the concrete {@link EnvironmentType}
 */
export abstract class ResourceLoader implements IResourceBase {
  /** The connectionId for this resource loader. */
  public abstract connectionId: ConnectionId;
  /** The parent connectionType for this resource loader. */
  public abstract connectionType: ConnectionType;

  /** Disposables belonging to all instances of ResourceLoader to be added to the extension
   * context during activation, cleaned up on extension deactivation.
   */
  protected static disposables: Disposable[] = [];

  /**  Return all known long lived disposables for extension cleanup. */
  public static getDisposables(): Disposable[] {
    return ResourceLoader.disposables;
  }

  static dispose() {
    ResourceLoader.disposables.forEach((d) => d.dispose());
    ResourceLoader.disposables = [];
  }

  // Map of connectionId to ResourceLoader instance.
  private static registry: Map<ConnectionId, ResourceLoader> = new Map();

  public static registerInstance(connectionId: ConnectionId, loader: ResourceLoader): void {
    ResourceLoader.registry.set(connectionId, loader);
  }

  public static deregisterInstance(connectionId: ConnectionId): void {
    ResourceLoader.registry.delete(connectionId);
  }

  /** Get all registered resource loaders */
  static loaders(): ResourceLoader[] {
    return Array.from(ResourceLoader.registry.values());
  }

  /** Get all registered DirectResourceLoader instances */
  static directLoaders(): DirectResourceLoader[] {
    return ResourceLoader.loaders().filter(
      (loader) => loader.connectionType === ConnectionType.Direct,
    ) as DirectResourceLoader[];
  }

  /** Get the ResourceLoader subclass instance corresponding to the given connectionId */
  public static getInstance(connectionId: ConnectionId): ResourceLoader {
    const loader = ResourceLoader.registry.get(connectionId);
    if (loader) {
      return loader;
    }

    throw new Error(`Unknown connectionId ${connectionId}`);
  }

  /** Reset the loader's state, forgetting anything learned about the connection. */
  public abstract reset(): Promise<void>;

  // Environment methods

  /**
   * Get this specific environment from the registered loader for this connectionId.
   * @param connectionId The connectionId to get the environment from.
   * @param environmentId The environmentId to get.
   * @returns The environment, or undefined if it could not be found from the proper loader instance.
   * @throws Error if a loader for connectionId is not registered.
   * @see {@link ResourceLoader.getInstance}
   */
  public static async getEnvironment(
    connectionId: ConnectionId,
    environmentId: EnvironmentId,
    forceDeepRefresh: boolean = false,
  ): Promise<Environment | undefined> {
    const loader = ResourceLoader.getInstance(connectionId);
    if (!loader) {
      throw new Error(`No loader registered for connectionId ${connectionId}`);
    }
    return await loader.getEnvironment(environmentId, forceDeepRefresh);
  }

  /** Fetch the Environment-subclass array from sidecar GraphQL. */
  protected abstract getEnvironmentsFromGraphQL(): Promise<Environment[] | undefined>;

  /**
   * Fetch the environments accessible from this connection.
   * @param forceDeepRefresh Should we ignore any cached resources and fetch anew?
   * @returns
   */
  public abstract getEnvironments(forceDeepRefresh?: boolean): Promise<Environment[]>;

  /** Find a specific environment within this loader instance by its id. */
  public async getEnvironment(
    environmentId: EnvironmentId,
    forceDeepRefresh: boolean = false,
  ): Promise<Environment | undefined> {
    const environments = await this.getEnvironments(forceDeepRefresh);
    return environments.find((env) => env.id === environmentId);
  }

  // Kafka cluster methods.

  /**
   * Get the kafka clusters in the given environment ID. If none,
   * returns an empty array.
   */
  public abstract getKafkaClustersForEnvironmentId(
    environmentId: EnvironmentId,
    forceDeepRefresh?: boolean,
  ): Promise<KafkaCluster[]>;

  /**
   * Return the topics present in the cluster, annotated with whether or not
   * they have a corresponding schema subject.
   */
  public abstract getTopicsForCluster(
    cluster: KafkaCluster,
    forceRefresh?: boolean,
  ): Promise<KafkaTopic[]>;

  // Schema registry methods.

  /**
   * Get all of the known schema registries from the environments from this connection.
   **/
  public abstract getSchemaRegistries(): Promise<SchemaRegistry[]>;

  public abstract getSchemaRegistryForEnvironmentId(
    environmentId: EnvironmentId,
  ): Promise<SchemaRegistry | undefined>;

  // Subjects and schemas methods.
  /**
   * Get the subjects from the schema registry for the given environment or schema registry.
   * If any route errors are encountered, a UI element is raised, and empty array is returned.
   * @param environmentId The environment to get the schema registry's subjects from.
   * @param forceDeepRefresh If true, will ignore any cached subjects and fetch anew.
   * @returns An array of subjects in the schema registry, or empty array if there was a route error. Throws
   *          any other errors.
   * */
  public async checkedGetSubjects(
    registryOrEnvironmentId: SchemaRegistry | EnvironmentId,
    forceRefresh: boolean = false,
  ): Promise<Subject[]> {
    try {
      return await this.getSubjects(registryOrEnvironmentId, forceRefresh);
    } catch (error) {
      if (isResponseError(error)) {
        void showWarningNotificationWithButtons(
          "Route error fetching schema registry subjects, continuing on without schemas.",
        );

        return [];
      } else {
        // getSubjects() will log the error, so we don't need to do it here.
        throw error;
      }
    }
  }

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
      } else if (isResponseError(error)) {
        // Some other route error. Not much we can do about it here. Let's not spam Sentry with
        // it, but do log it.
        logError(error, "getSubjects(): Route error fetching subjects");
        throw error;
      } else {
        // Unexpected error, log it to sentry.
        logError(error, "Unexpected error within getSubjects", {
          extra: { registryOrEnvironmentId: JSON.stringify(registryOrEnvironmentId, null, 2) },
        });
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
      logError(error, "Error deleting schema version", {
        extra: {
          connectionId: schema.connectionId,
          environmentId: schema.environmentId ? schema.environmentId : "unknown",
          schemaRegistryId: schema.schemaRegistryId,
          hardDelete: hardDelete ? "true" : "false",
        },
      });
      throw error;
    }

    if (shouldClearSubject) {
      // Clear out the cache for the whole of the schema registry.
      await this.clearCache(schema.subjectObject());
    }
  }

  /**
   *
   * @param subject The subject to delete. Must carry all of the schema versions to delete within its `.schemas` property.
   * @param hardDelete Should each schema version be hard or soft deleted?
   */
  public async deleteSchemaSubject(subject: Subject, hardDelete: boolean): Promise<void> {
    const subjectApi = (await getSidecar()).getSubjectsV1Api(
      subject.schemaRegistryId,
      subject.connectionId,
    );

    // Will have to do either one or two requests to delete the subject, based on hardness.
    const requests: DeleteSubjectRequest[] = [];

    if (hardDelete) {
      // Must do a soft delete first, then hard delete.
      requests.push({
        subject: subject.name,
        permanent: false,
      });
    }

    // Now can perform either a hard or a soft delete.
    requests.push({
      subject: subject.name,
      permanent: hardDelete,
    });

    try {
      for (const request of requests) {
        await subjectApi.deleteSubject(request);
      }
    } catch (error) {
      logError(error, "Error deleting schema subject", {
        extra: {
          connectionId: subject.connectionId,
          environmentId: subject.environmentId,
          schemaRegistryId: subject.schemaRegistryId,
          hardDelete: hardDelete ? "true" : "false",
        },
      });
      throw error;
    } finally {
      // Always clear out the subject cache, regardless of whether the delete was successful.
      // because a failure could have been encountered half way through deleting
      // schema versions and the subject remains.
      const schemaRegistry = await this.getSchemaRegistryForEnvironmentId(subject.environmentId);
      if (schemaRegistry) {
        await this.clearCache(schemaRegistry);
      }
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
  public async clearCache(resource: SchemaRegistry | Subject): Promise<void> {
    if (resource.connectionId !== this.connectionId) {
      throw new Error(
        `Mismatched connectionId ${this.connectionId} for resource ${JSON.stringify(resource, null, 2)}`,
      );
    }

    const resourceManager = getResourceManager();

    // Clear out cached subjects, if any. Clearing out a single subject rounds up to clearing the whole
    // schema registry by conscious design (the set of subjects for schema registry is the smallest
    // cache scope, so marking a single subject as unknown is treated as marking the whole schema registry's
    // cache of subjects as unknown and will prompt a subsequent deep fetch of subjects).
    logger.debug(`Clearing subject cache for schema registry ${resource.schemaRegistryId}`);
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
