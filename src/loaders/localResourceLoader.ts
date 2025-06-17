import { ConnectionType } from "../clients/sidecar";
import { LOCAL_CONNECTION_ID } from "../constants";
import { getLocalResources } from "../graphql/local";
import { LocalEnvironment } from "../models/environment";
import { LocalKafkaCluster } from "../models/kafkaCluster";
import { LocalSchemaRegistry } from "../models/schemaRegistry";
import { CachingResourceLoader } from "./resourceLoader";

/**
 * ResourceLoader implementation atop the LOCAL "cluster".
 * Does no caching at all. Directly fetches from the local sidecar API
 * each time a resource is requested.
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
    return await getLocalResources();
  }
}
