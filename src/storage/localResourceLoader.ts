import { TopicData } from "../clients/kafkaRest/models";
import { LOCAL_CONNECTION_ID } from "../constants";
import { getLocalResources } from "../graphql/local";
import { Logger } from "../logging";
import { Environment, LocalEnvironment } from "../models/environment";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { Schema } from "../models/schema";
import { LocalSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import {
  correlateTopicsWithSchemas,
  fetchSchemas,
  fetchTopics,
  ResourceLoader,
  ResourceLoaderType,
} from "./resourceLoader";

const logger = new Logger("storage.localResourceLoader");

/**
 * ResourceLoader implementation atop the LOCAL "cluster".
 * Does no caching at all. Directly fetches from the local sidecar API
 * each time a resource is requested.
 */
export class LocalResourceLoader extends ResourceLoader {
  kind = ResourceLoaderType.Local;

  private static instance: LocalResourceLoader | null = null;
  public static getInstance(): LocalResourceLoader {
    if (!LocalResourceLoader.instance) {
      LocalResourceLoader.instance = new LocalResourceLoader();
    }
    return LocalResourceLoader.instance;
  }

  // singleton class, get instance via getInstance()
  // (construct only public for testing / signon mocking purposes.)
  private constructor() {
    super();
  }

  public async getEnvironments(): Promise<Environment[]> {
    // todo: resolve the impedance mismatch between
    // LocalResourceGroup vs LocalEnvironment. Perhaps have getLocalResources
    // return something closer to an evolved LocalEnvironment?
    const localResourceGroups = await getLocalResources();
    if (localResourceGroups.length === 0) {
      return [];
    } else {
      // respell as a single LocalEnvironment
      return [
        LocalEnvironment.create({
          id: "local",
          name: "Local",
          hasClusters: true,
        }),
      ];
    }
  }

  public async getKafkaClustersForEnvironmentId(): Promise<LocalKafkaCluster[]> {
    const localGroups = await getLocalResources();
    return localGroups.flatMap((group) => group.kafkaClusters);
  }

  /**
   * Return the topics present in the {@link LocalKafkaCluster}. Will also correlate with schemas
   * in the schema registry for the cluster, if any.
   */
  public async getTopicsForCluster(cluster: LocalKafkaCluster): Promise<KafkaTopic[]> {
    if (!cluster.isLocal) {
      throw new Error(
        `Cluster ${cluster.id} is not a local cluster, yet is passed to LocalResourceLoader.`,
      );
    }

    // Deep fetch the schemas and the topics concurrently.
    const [schemas, responseTopics]: [Schema[], TopicData[]] = await Promise.all([
      this.getSchemasForEnvironmentId(),
      fetchTopics(cluster),
    ]);

    return correlateTopicsWithSchemas(cluster, responseTopics, schemas);
  }

  public async getSchemaRegistries(): Promise<LocalSchemaRegistry[]> {
    const localGroups = await getLocalResources();

    return localGroups
      .filter((group) => group.schemaRegistry !== undefined)
      .map((group) => group.schemaRegistry!);
  }

  public async getSchemaRegistryForEnvironmentId(): Promise<LocalSchemaRegistry | undefined> {
    const allRegistries = await this.getSchemaRegistries();
    if (allRegistries.length === 0) {
      return undefined;
    } else {
      // local environment should only have at most one schema registry
      if (allRegistries.length > 1) {
        logger.warn(
          "Local environment has more than one schema registry! Using first one",
          allRegistries.length,
        );
      }
      return allRegistries[0];
    }
  }

  public async getSchemasForEnvironmentId(): Promise<Schema[]> {
    const schemaRegistries = await this.getSchemaRegistries();
    if (schemaRegistries.length === 0) {
      return [];
    }

    return fetchSchemas(schemaRegistries[0].id, LOCAL_CONNECTION_ID, undefined);
  }

  /**
   * Fetch schemas from local schema registry.
   * Simple, pass through to deep fetch every time.
   */
  public async getSchemasForRegistry(schemaRegistry: SchemaRegistry): Promise<Schema[]> {
    return fetchSchemas(schemaRegistry.id, LOCAL_CONNECTION_ID, undefined);
  }

  /** Purge schemas from this registry from cache.
   * Simple, we don't cache anything in this loader!
   */
  public purgeSchemas(): void {
    // no-op
  }
}
