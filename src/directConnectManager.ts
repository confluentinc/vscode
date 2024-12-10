import { randomUUID } from "crypto";
import { Disposable, ProgressLocation, SecretStorageChangeEvent, window } from "vscode";
import {
  Connection,
  ConnectionsList,
  ConnectionSpec,
  ConnectionsResourceApi,
  ConnectionType,
  KafkaClusterConfig,
  ResponseError,
  SchemaRegistryConfig,
} from "./clients/sidecar";
import { getExtensionContext } from "./context/extension";
import { directConnectionsChanged, environmentChanged } from "./emitters";
import { ExtensionContextNotSetError } from "./errors";
import { Logger } from "./logging";
import { ConnectionId, isDirect } from "./models/resource";
import { getSidecar } from "./sidecar";
import {
  tryToCreateConnection,
  tryToDeleteConnection,
  tryToUpdateConnection,
  waitForConnectionToBeUsable,
} from "./sidecar/connections";
import { SecretStorageKeys } from "./storage/constants";
import { DirectResourceLoader } from "./storage/directResourceLoader";
import { ResourceLoader } from "./storage/resourceLoader";
import {
  CustomConnectionSpec,
  DirectConnectionsById,
  getResourceManager,
} from "./storage/resourceManager";
import { logUsage, UserEvent } from "./telemetry/events";
import { getSchemasViewProvider } from "./viewProviders/schemas";
import { getTopicViewProvider } from "./viewProviders/topics";
import { FormConnectionType, PostResponse } from "./webview/direct-connect-form";

const logger = new Logger("directConnectManager");

/**
 * Singleton class responsible for the following:
 *   associated context value(s) to enable/disable actions
 * - creating connections via input from the webview form and updating the Resources view
 * - fetching connections from persistent storage and deconflicting with the sidecar
 * - deleting connections through actions on the Resources view
 * - firing events when the connection list changes or a specific connection is updated/deleted
 */
export class DirectConnectionManager {
  /** Disposables belonging to this class to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: Disposable[] = [];

  // singleton instance to prevent multiple listeners and single source of connection management
  private static instance: DirectConnectionManager | null = null;
  private constructor() {
    const context = getExtensionContext();
    if (!context) {
      // need access to SecretStorage to manage connection secrets
      throw new ExtensionContextNotSetError("DirectConnectionManager");
    }
    const listeners = this.setEventListeners();
    this.disposables.push(...listeners);
  }

  static getInstance(): DirectConnectionManager {
    if (!DirectConnectionManager.instance) {
      DirectConnectionManager.instance = new DirectConnectionManager();
    }
    return DirectConnectionManager.instance;
  }

  private setEventListeners(): Disposable[] {
    const connectionsListener: Disposable = getExtensionContext().secrets.onDidChange(
      async ({ key }: SecretStorageChangeEvent) => {
        // watch for any cross-workspace direct connection additions/removals
        if (key === SecretStorageKeys.DIRECT_CONNECTIONS) {
          const connections: DirectConnectionsById =
            await getResourceManager().getDirectConnections();
          // ensure all DirectResourceLoader instances are up to date
          // part 1: ensure any new connections have registered loaders; if this isn't done, hopping
          // workspaces and attempting to focus on a direct connection-based resource will fail with
          // the `Unknown connection ID` error
          const existingLoaderIds: ConnectionId[] = ResourceLoader.loaders()
            .filter((loader) => loader.connectionType === "DIRECT")
            .map((loader) => loader.connectionId);
          for (const id of connections.keys()) {
            if (!existingLoaderIds.includes(id)) {
              this.initResourceLoader(id);
            }
          }
          // part 2: remove any direct connections not in the secret storage to prevent
          // requests to orphaned resources/connections
          for (const id of existingLoaderIds) {
            if (!connections.has(id)) {
              ResourceLoader.deregisterInstance(id);
            }
          }

          // this is mainly to inform the Resources view to refresh its list of connections
          directConnectionsChanged.fire();

          // if the Topics/Schemas views were focused on a resource whose direct connection was removed,
          // reset the view(s) to prevent orphaned resources from being used for requests
          const topicsView = getTopicViewProvider();
          if (topicsView.kafkaCluster && isDirect(topicsView.kafkaCluster)) {
            if (!connections.has(topicsView.kafkaCluster.connectionId)) {
              topicsView.reset();
            }
          }
          const schemasView = getSchemasViewProvider();
          if (schemasView.schemaRegistry && isDirect(schemasView.schemaRegistry)) {
            if (!connections.has(schemasView.schemaRegistry.connectionId)) {
              schemasView.reset();
            }
          }
        }
      },
    );

    return [connectionsListener];
  }

  /**
   * Create a new direct connection with the configurations provided from the webview form.
   * @see `src/webview/direct-connection-form.ts` for the form submission handling.
   */
  async createConnection(
    kafkaClusterConfig: KafkaClusterConfig | undefined,
    schemaRegistryConfig: SchemaRegistryConfig | undefined,
    formConnectionType: FormConnectionType,
    name?: string,
  ): Promise<PostResponse> {
    const connectionId = randomUUID() as ConnectionId;
    const spec: CustomConnectionSpec = {
      id: connectionId,
      name: name || "New Connection",
      type: ConnectionType.Direct, // TODO(shoup): update for MDS in follow-on branch
      formConnectionType,
    };

    if (kafkaClusterConfig) {
      spec.kafka_cluster = kafkaClusterConfig;
    }
    if (schemaRegistryConfig) {
      spec.schema_registry = schemaRegistryConfig;
    }

    const { connection, errorMessage } = await this.createOrUpdateConnection(spec);
    if (errorMessage || !connection) {
      return { success: false, message: errorMessage };
    }

    logUsage(UserEvent.DirectConnectionAction, {
      type: formConnectionType,
      action: "created",
      withKafka: !!kafkaClusterConfig,
      withSchemaRegistry: !!schemaRegistryConfig,
    });

    // save the new connection in secret storage
    await getResourceManager().addDirectConnection(spec);
    // create a new ResourceLoader instance for managing the new connection's resources
    this.initResourceLoader(connectionId);

    // `message` is hard-coded in the webview, so we don't actually use the connection object yet
    return { success: true, message: JSON.stringify(connection) };
  }

  async deleteConnection(id: ConnectionId): Promise<void> {
    const spec: CustomConnectionSpec | null = await getResourceManager().getDirectConnection(id);
    await Promise.all([getResourceManager().deleteDirectConnection(id), tryToDeleteConnection(id)]);

    logUsage(UserEvent.DirectConnectionAction, {
      type: spec?.formConnectionType,
      action: "deleted",
      withKafka: !!spec?.kafka_cluster,
      withSchemaRegistry: !!spec?.schema_registry,
    });

    ResourceLoader.deregisterInstance(id);
  }

  async updateConnection(spec: CustomConnectionSpec): Promise<PostResponse> {
    // tell the sidecar about the updated spec
    const { connection, errorMessage } = await this.createOrUpdateConnection(spec, true);
    if (errorMessage || !connection) {
      return { success: false, message: errorMessage };
    }

    // combine the returned ConnectionSpec with the CustomConnectionSpec before storing
    // (spec comes first because the ConnectionSpec will try to override `id` as a string)
    const mergedSpec: CustomConnectionSpec = {
      ...connection.spec,
      id: spec.id,
      formConnectionType: spec.formConnectionType,
    };
    // update the connection in secret storage (via full replace of the connection by its id)
    await getResourceManager().addDirectConnection(mergedSpec);
    // notify subscribers that the "environment" has changed since direct connections are treated
    // as environment-specific resources
    environmentChanged.fire(mergedSpec.id);
    return { success: true, message: JSON.stringify(connection) };
  }

  /**
   * Attempt to create or update a {@link Connection} in the sidecar based on the provided
   * {@link ConnectionSpec}.
   *
   * If the request/operation fails, the `errorMessage` will be populated with the error message and
   * the `connection` will be `null`.
   * Otherwise, the `connection` will be the updated/created connection object and the `errorMessage`
   * will be `null`.
   */
  private async createOrUpdateConnection(
    spec: ConnectionSpec,
    update: boolean = false,
  ): Promise<{ connection: Connection | null; errorMessage: string | null }> {
    let connection: Connection | null = null;
    let errorMessage: string | null = null;
    try {
      connection = update ? await tryToUpdateConnection(spec) : await tryToCreateConnection(spec);
      const connectionId = connection.spec.id as ConnectionId;
      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: `Waiting for "${connection.spec.name}" to be usable...`,
        },
        async () => {
          await waitForConnectionToBeUsable(connectionId);
        },
      );
    } catch (error) {
      // logging happens in the above call
      if (error instanceof ResponseError) {
        errorMessage = await error.response.clone().text();
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      const msg = `Failed to ${update ? "update" : "create"} connection: ${errorMessage}`;
      logger.error(msg);
      window.showErrorMessage(msg);
    }
    return { connection, errorMessage };
  }

  /**
   * Initialize a new {@link DirectResourceLoader} instance for the given connection ID.
   * @param id The unique identifier for the connection.
   */
  initResourceLoader(id: ConnectionId) {
    ResourceLoader.registerInstance(id, new DirectResourceLoader(id));
  }

  /**
   * Compare the known connections between our SecretStorage and the sidecar, creating any missing
   * connections in the sidecar.
   *
   * Also ensure the {@link DirectResourceLoader} instances are available for the {@link ConnectionId}.
   */
  async rehydrateConnections() {
    const sidecar = await getSidecar();
    const client: ConnectionsResourceApi = sidecar.getConnectionsResourceApi();

    const [sidecarConnections, storedConnections]: [ConnectionsList, DirectConnectionsById] =
      await Promise.all([
        client.gatewayV1ConnectionsGet(),
        getResourceManager().getDirectConnections(),
      ]);
    const sidecarDirectConnections: Connection[] = sidecarConnections.data.filter(
      (connection: Connection) => connection.spec.type === ConnectionType.Direct,
    );
    logger.debug(
      `looked up existing direct connections -> sidecar: ${sidecarDirectConnections.length}, stored: ${Array.from(storedConnections.entries()).length}`,
    );

    // if there are any stored connections that the sidecar doesn't know about, create them
    const newConnectionPromises: Promise<Connection>[] = [];
    // and also keep track of which ones we need to make a GET request against for the first time to
    // ensure they're properly loaded in the sidecar
    const connectionIdsToCheck: ConnectionId[] = [];
    for (const [id, connectionSpec] of storedConnections.entries()) {
      if (!sidecarDirectConnections.find((conn) => conn.spec.id === id)) {
        logger.debug("telling sidecar about stored connection:", { id });
        newConnectionPromises.push(tryToCreateConnection(connectionSpec));
        connectionIdsToCheck.push(id);
      }
      // create a new ResourceLoader instance for managing the new connection's resources
      this.initResourceLoader(id);
    }

    if (newConnectionPromises.length > 0) {
      // wait for all new connections to be created before checking their status
      await Promise.all(newConnectionPromises);
      // ensure the new connections are usable before refreshing the Resources view
      await Promise.all(connectionIdsToCheck.map((id) => waitForConnectionToBeUsable(id)));
      logger.debug(
        `created and checked ${connectionIdsToCheck.length} new connection(s), firing event`,
      );
      directConnectionsChanged.fire();
    }
  }
}
