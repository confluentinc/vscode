import { ConnectionType } from "../clients/sidecar";
import { getDirectResources } from "../graphql/direct";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId } from "../models/resource";
import { Schema } from "../models/schema";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import { fetchSchemas } from "./loaderUtils";
import { ResourceLoader } from "./resourceLoader";

/**
 * {@link ResourceLoader} implementation for direct connections.
 *
 * Similar to the `LocalResourceLoader` in that it doesn't cache anything, but the
 * {@link DirectResourceLoader} keeps track of its own {@link ConnectionId} and is not a singleton.
 */
export class DirectResourceLoader extends ResourceLoader {
  connectionId: ConnectionId;
  connectionType = ConnectionType.Direct;

  // non-singleton since we have to manager per-connection loading
  constructor(id: ConnectionId) {
    super();
    this.connectionId = id;
  }

  async getEnvironments(): Promise<DirectEnvironment[]> {
    const envs: DirectEnvironment[] = await getDirectResources();
    // should only return an array of one DirectEnvironment
    return envs.filter((env) => env.connectionId === this.connectionId);
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

  async getSchemasForEnvironmentId(environmentId: string | undefined): Promise<Schema[]> {
    const schemaRegistry: DirectSchemaRegistry | undefined =
      await this.getSchemaRegistryForEnvironmentId(environmentId);
    if (!schemaRegistry) {
      return [];
    }
    return this.getSchemasForRegistry(schemaRegistry);
  }

  async getSchemasForRegistry(schemaRegistry: DirectSchemaRegistry): Promise<Schema[]> {
    return fetchSchemas(schemaRegistry);
  }

  purgeSchemas(): void {
    // no-op
  }
}
