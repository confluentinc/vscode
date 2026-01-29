import { ConnectionType } from "../connections";
import { LOCAL_CONNECTION_ID } from "../constants";
import { createLocalResourceFetcher } from "../fetchers";
import { Logger } from "../logging";
import type { LocalEnvironment } from "../models/environment";
import type { LocalKafkaCluster } from "../models/kafkaCluster";
import type { LocalSchemaRegistry } from "../models/schemaRegistry";
import { CachingResourceLoader } from "./cachingResourceLoader";

const logger = new Logger("loaders.localResourceLoader");

/**
 * ResourceLoader implementation atop the LOCAL "cluster".
 */
export class LocalResourceLoader extends CachingResourceLoader<
  LocalEnvironment,
  LocalKafkaCluster,
  LocalSchemaRegistry
> {
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

  protected async getEnvironmentsFromGraphQL(): Promise<LocalEnvironment[]> {
    logger.debug("Using internal fetcher for local resources");
    const fetcher = createLocalResourceFetcher();
    const environment = await fetcher.discoverResources();
    return environment ? [environment] : [];
  }
}
