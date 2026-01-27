import { ConnectionType } from "../clients/sidecar";
import { USE_INTERNAL_FETCHERS } from "../extensionSettings/constants";
import { createDirectResourceFetcher } from "../fetchers";
import { getDirectResources } from "../graphql/direct";
import { Logger } from "../logging";
import type { DirectEnvironment } from "../models/environment";
import type { DirectKafkaCluster } from "../models/kafkaCluster";
import type { ConnectionId } from "../models/resource";
import type { DirectSchemaRegistry } from "../models/schemaRegistry";
import { getResourceManager } from "../storage/resourceManager";
import { CachingResourceLoader } from "./cachingResourceLoader";

/**
 * {@link ResourceLoader} implementation for direct connections.
 *
 * Similar to the `LocalResourceLoader` in that it doesn't cache anything, but the
 * {@link DirectResourceLoader} keeps track of its own {@link ConnectionId} and is not a singleton.
 */
export class DirectResourceLoader extends CachingResourceLoader<
  DirectEnvironment,
  DirectKafkaCluster,
  DirectSchemaRegistry
> {
  connectionId: ConnectionId;
  connectionType = ConnectionType.Direct;
  logger: Logger;

  // non-singleton since we have to manager per-connection loading
  constructor(id: ConnectionId) {
    super();
    this.connectionId = id;
    this.logger = new Logger(`DirectResourceLoader ${id}`);
  }

  protected async getEnvironmentsFromGraphQL(): Promise<DirectEnvironment[] | undefined> {
    // Check feature flag for internal fetcher usage
    if (USE_INTERNAL_FETCHERS.value) {
      this.logger.debug("Using internal fetcher for direct connection resources");
      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async (id) => getResourceManager().getDirectConnection(id),
      });
      const environment = await fetcher.buildEnvironment(this.connectionId);
      if (!environment) {
        this.logger.warn("No environment found for direct connection (internal fetcher)", {
          connectionId: this.connectionId,
        });
        return undefined;
      }
      return [environment];
    }

    // Fall back to GraphQL
    const environment = await getDirectResources(this.connectionId);
    if (!environment) {
      this.logger.warn("No environment found for direct connection", {
        connectionId: this.connectionId,
      });
      return undefined;
    }
    return [environment];
  }
}
