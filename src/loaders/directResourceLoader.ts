import { ConnectionType } from "../clients/sidecar";
import { getDirectResources } from "../graphql/direct";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId } from "../models/resource";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import { ResourceLoader } from "./resourceLoader";

/**
 * {@link ResourceLoader} implementation for direct connections.
 *
 * Similar to the `LocalResourceLoader` in that it doesn't cache anything, but the
 * {@link DirectResourceLoader} keeps track of its own {@link ConnectionId} and is not a singleton.
 */
export class DirectResourceLoader extends ResourceLoader {
  connectionId: ConnectionId;
  cachedEnvironments: DirectEnvironment[] | undefined;
  connectionType = ConnectionType.Direct;

  // non-singleton since we have to manager per-connection loading
  constructor(id: ConnectionId) {
    super();
    this.connectionId = id;
    this.cachedEnvironments = undefined;
  }

  async getEnvironments(forceDeepRefresh: boolean = false): Promise<DirectEnvironment[]> {
    if (!this.cachedEnvironments || forceDeepRefresh) {
      // Fetch all of them, across all direct connections, sigh.
      const envs: DirectEnvironment[] = await getDirectResources();
      // Filter down to just "mine."" Should only be an array of one DirectEnvironment
      this.cachedEnvironments = envs.filter((env) => env.connectionId === this.connectionId);
    }
    return this.cachedEnvironments;
  }

  async getKafkaClustersForEnvironmentId(environmentId: string): Promise<DirectKafkaCluster[]> {
    const envs: DirectEnvironment[] = await this.getEnvironments();
    const env = envs.find((env) => env.id === environmentId);
    if (!env) {
      throw new Error(`Unknown environmentId ${environmentId}`);
    }
    return env.kafkaClusters;
  }

  async getSchemaRegistries(): Promise<DirectSchemaRegistry[]> {
    const envs: DirectEnvironment[] = await this.getEnvironments();
    const schemaRegistries: DirectSchemaRegistry[] = [];
    envs.forEach((env) => {
      if (env.schemaRegistry) {
        schemaRegistries.push(env.schemaRegistry);
      }
    });
    return schemaRegistries;
  }

  async getSchemaRegistryForEnvironmentId(
    environmentId: string | undefined,
  ): Promise<DirectSchemaRegistry | undefined> {
    const schemaRegistries: DirectSchemaRegistry[] = await this.getSchemaRegistries();
    return schemaRegistries.find((sr) => sr.environmentId === environmentId);
  }
}
