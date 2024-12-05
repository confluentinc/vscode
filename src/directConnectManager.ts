import { randomUUID } from "crypto";
import {
  ConfigurationChangeEvent,
  Disposable,
  SecretStorageChangeEvent,
  window,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
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
import { ContextValues, setContextValue } from "./context/values";
import { ExtensionContextNotSetError } from "./errors";
import { Logger } from "./logging";
import { ConnectionId, isDirect } from "./models/resource";
import { ENABLE_DIRECT_CONNECTIONS } from "./preferences/constants";
import { getSidecar } from "./sidecar";
import {
  tryToCreateConnection,
  tryToDeleteConnection,
  tryToUpdateConnection,
} from "./sidecar/connections";
import { SecretStorageKeys } from "./storage/constants";
import { DirectResourceLoader } from "./storage/directResourceLoader";
import { ResourceLoader } from "./storage/resourceLoader";
import { DirectConnectionsById, getResourceManager } from "./storage/resourceManager";
import { getTelemetryLogger } from "./telemetry/telemetryLogger";
import { getResourceViewProvider } from "./viewProviders/resources";
import { getSchemasViewProvider } from "./viewProviders/schemas";
import { getTopicViewProvider } from "./viewProviders/topics";
import { PostResponse } from "./webview/direct-connect-form";

const logger = new Logger("directConnectManager");

/**
 * Singleton class responsible for the following:
 * - watching for changes in the {@link ENABLE_DIRECT_CONNECTIONS} experimental setting and adjusting
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
    // watch the extension settings and toggle the associated context value accordingly
    const settingsListener: Disposable = workspace.onDidChangeConfiguration(
      async (event: ConfigurationChangeEvent) => {
        const configs: WorkspaceConfiguration = workspace.getConfiguration();
        if (event.affectsConfiguration(ENABLE_DIRECT_CONNECTIONS)) {
          const enabled = configs.get(ENABLE_DIRECT_CONNECTIONS, false);
          logger.debug(`"${ENABLE_DIRECT_CONNECTIONS}" config changed`, { enabled });
          setContextValue(ContextValues.directConnectionsEnabled, enabled);
          // "Other" container item will be toggled
          getResourceViewProvider().refresh();
          // if the Topics/Schemas views are focused on a direct connection based resource, wipe them
          if (!enabled) {
            const topicsView = getTopicViewProvider();
            if (topicsView.kafkaCluster && isDirect(topicsView.kafkaCluster)) {
              topicsView.reset();
            }
            const schemasView = getSchemasViewProvider();
            if (schemasView.schemaRegistry && isDirect(schemasView.schemaRegistry)) {
              schemasView.reset();
            }
          }
        }
      },
    );

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

          // refresh the Resources view to stay in sync with the secret storage
          getResourceViewProvider().refresh();

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

    return [settingsListener, connectionsListener];
  }

  /**
   * Create a new direct connection with the configurations provided from the webview form.
   * @see `src/webview/direct-connection-form.ts` for the form submission handling.
   */
  async createConnection(
    kafkaClusterConfig: KafkaClusterConfig | undefined,
    schemaRegistryConfig: SchemaRegistryConfig | undefined,
    name?: string,
    platform?: string,
  ): Promise<PostResponse> {
    const connectionId = randomUUID() as ConnectionId;
    const spec: ConnectionSpec = {
      id: connectionId,
      name: name || "New Connection",
      type: ConnectionType.Direct, // TODO(shoup): update for MDS in follow-on branch
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

    getTelemetryLogger().logUsage("Connection", {
      type: platform,
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
    await Promise.all([getResourceManager().deleteDirectConnection(id), tryToDeleteConnection(id)]);

    // TODO(shoup): look up connection platform once we begin storing it alongside the spec
    getTelemetryLogger().logUsage("Connection", {
      action: "deleted",
    });

    ResourceLoader.deregisterInstance(id);
  }

  async updateConnection(spec: ConnectionSpec): Promise<PostResponse> {
    // tell the sidecar about the updated spec
    const { connection, errorMessage } = await this.createOrUpdateConnection(spec, true);
    if (errorMessage || !connection) {
      return { success: false, message: errorMessage };
    }

    // update the connection in secret storage (via full replace of the connection by its id)
    await getResourceManager().addDirectConnection(connection.spec);
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
    } catch (error) {
      // logging happens in the above call
      if (error instanceof ResponseError) {
        errorMessage = await error.response.clone().text();
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      window.showErrorMessage(`Failed to create connection: ${errorMessage}`);
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
    for (const [id, connectionSpec] of storedConnections.entries()) {
      if (!sidecarDirectConnections.find((conn) => conn.spec.id === id)) {
        logger.debug("telling sidecar about stored connection:", { id });
        newConnectionPromises.push(tryToCreateConnection(connectionSpec));
      }
      // create a new ResourceLoader instance for managing the new connection's resources
      this.initResourceLoader(id);
    }

    if (newConnectionPromises.length > 0) {
      await Promise.all(newConnectionPromises);
      getResourceViewProvider().refresh();
    }
  }
}
