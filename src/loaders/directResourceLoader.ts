import { ConnectionType } from "../clients/sidecar";
import { getDirectResources } from "../graphql/direct";
import { Logger } from "../logging";
import type { DirectEnvironment } from "../models/environment";
import type { DirectKafkaCluster } from "../models/kafkaCluster";
import type { ConnectionId } from "../models/resource";
import type { DirectSchemaRegistry } from "../models/schemaRegistry";
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
    // Drive the GQL query. Wil return a single DirectEnvironment.
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
