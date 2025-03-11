import { ConnectionType } from "../clients/sidecar";
import { LOCAL_CONNECTION_ID } from "../constants";
import { getLocalResources } from "../graphql/local";
import { Logger } from "../logging";
import { LocalEnvironment } from "../models/environment";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { LocalSchemaRegistry } from "../models/schemaRegistry";
import { ResourceLoader } from "./resourceLoader";

const logger = new Logger("storage.localResourceLoader");

/**
 * ResourceLoader implementation atop the LOCAL "cluster".
 * Does no caching at all. Directly fetches from the local sidecar API
 * each time a resource is requested.
 */
export class LocalResourceLoader extends ResourceLoader {
  connectionId = LOCAL_CONNECTION_ID;
  connectionType = ConnectionType.Local;

  private static instance: LocalResourceLoader | null = null;
  public static getInstance(): LocalResourceLoader {
    if (!LocalResourceLoader.instance) {
      LocalResourceLoader.instance = new LocalResourceLoader();
    }
    return LocalResourceLoader.instance;
  }

  // singleton class, get instance via getInstance()
  constructor() {
    if (LocalResourceLoader.instance) {
      throw new Error("Use LocalResourceLoader.getInstance()");
    }
    super();
  }

  public async getEnvironments(): Promise<LocalEnvironment[]> {
    return await getLocalResources();
  }

  async getKafkaClustersForEnvironmentId(environmentId: string): Promise<LocalKafkaCluster[]> {
    const envs: LocalEnvironment[] = await this.getEnvironments();
    // should only ever be one, but we'll filter just in case
    const env = envs.find((env) => env.id === environmentId);
    if (!env) {
      throw new Error(`Unknown environmentId ${environmentId}`);
    }
    return env.kafkaClusters;
  }

  public async getSchemaRegistries(): Promise<LocalSchemaRegistry[]> {
    const envs: LocalEnvironment[] = await this.getEnvironments();
    const schemaRegistries: LocalSchemaRegistry[] = [];
    envs.forEach((env) => {
      if (env.schemaRegistry) {
        schemaRegistries.push(env.schemaRegistry);
      }
    });
    return schemaRegistries;
  }

  public async getSchemaRegistryForEnvironmentId(): Promise<LocalSchemaRegistry | undefined> {
    const allRegistries: LocalSchemaRegistry[] = await this.getSchemaRegistries();
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
}
