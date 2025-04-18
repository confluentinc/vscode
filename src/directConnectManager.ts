import { randomUUID } from "crypto";
import { Disposable, ProgressLocation, SecretStorageChangeEvent, window } from "vscode";
import {
  Connection,
  ConnectionsList,
  ConnectionSpec,
  ConnectionsResourceApi,
  ConnectionType,
  ResponseError,
} from "./clients/sidecar";
import { getExtensionContext } from "./context/extension";
import { directConnectionsChanged } from "./emitters";
import { ExtensionContextNotSetError } from "./errors";
import { DirectResourceLoader, ResourceLoader } from "./loaders";
import { Logger } from "./logging";
import { ConnectionId, isDirect } from "./models/resource";
import { getSidecar } from "./sidecar";
import {
  tryToCreateConnection,
  tryToDeleteConnection,
  tryToUpdateConnection,
} from "./sidecar/connections";
import { ConnectionStateWatcher, waitForConnectionToBeStable } from "./sidecar/connections/watcher";
import { SecretStorageKeys } from "./storage/constants";
import {
  CustomConnectionSpec,
  DirectConnectionsById,
  getResourceManager,
} from "./storage/resourceManager";
import { logUsage, UserEvent } from "./telemetry/events";
import { getSchemasViewProvider } from "./viewProviders/schemas";
import { getTopicViewProvider } from "./viewProviders/topics";
import { getCredentialsType } from "./directConnections/credentials";

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
              await schemasView.reset();
            }
          }
        }
      },
    );

    return [connectionsListener];
  }

  /**
   * Create a new direct connection with the configurations provided from the webview form.
   * @see `src/directConnect.ts` for the form data processing.
   * @see `src/webview/direct-connection-form` for the form UI handling.
   */
  async createConnection(
    spec: CustomConnectionSpec,
    dryRun: boolean = false,
  ): Promise<{ connection: Connection | null; errorMessage: string | null }> {
    let incomingSpec: ConnectionSpec = spec;
    // check for an existing ConnectionSpec
    const currentSpec: ConnectionSpec | null = await getResourceManager().getDirectConnection(
      spec.id,
    );
    if (dryRun && currentSpec) {
      incomingSpec.id = randomUUID() as ConnectionId; // dryRun must have unique ID
    }
    const { connection, errorMessage } = await this.createOrUpdateConnection(
      incomingSpec,
      false,
      dryRun,
    );

    logUsage(UserEvent.DirectConnectionAction, {
      action: dryRun ? "tested" : "created",
      type: spec.formConnectionType,
      specifiedConnectionType: spec.specifiedConnectionType,
      withKafka: !!spec.kafka_cluster,
      withSchemaRegistry: !!spec.schema_registry,
      kafkaAuthType: getCredentialsType(spec.kafka_cluster?.credentials),
      schemaRegistryAuthType: getCredentialsType(spec.schema_registry?.credentials),
    });

    if (connection && !dryRun) {
      // save the new connection in secret storage
      await getResourceManager().addDirectConnection(spec);
      // create a new ResourceLoader instance for managing the new connection's resources
      this.initResourceLoader(spec.id);
    }
    return { connection, errorMessage };
  }

  async deleteConnection(id: ConnectionId): Promise<void> {
    const spec: CustomConnectionSpec | null = await getResourceManager().getDirectConnection(id);
    await Promise.all([getResourceManager().deleteDirectConnection(id), tryToDeleteConnection(id)]);

    logUsage(UserEvent.DirectConnectionAction, {
      action: "deleted",
      type: spec?.formConnectionType,
      specifiedConnectionType: spec?.specifiedConnectionType,
      withKafka: !!spec?.kafka_cluster,
      withSchemaRegistry: !!spec?.schema_registry,
      kafkaAuthType: getCredentialsType(spec?.kafka_cluster?.credentials),
      kafkaSslEnabled: spec?.kafka_cluster?.ssl?.enabled,
      schemaRegistryAuthType: getCredentialsType(spec?.schema_registry?.credentials),
      schemaRegistrySslEnabled: spec?.schema_registry?.ssl?.enabled,
    });

    ResourceLoader.deregisterInstance(id);
  }

  async updateConnection(incomingSpec: CustomConnectionSpec): Promise<void> {
    // tell the sidecar about the updated spec
    const { connection, errorMessage } = await this.createOrUpdateConnection(incomingSpec, true);
    if (errorMessage || !connection) {
      window.showErrorMessage(
        `Error: Failed to update connection. ${errorMessage ?? "No connection object returned"}`,
      );
      return;
    }

    logUsage(UserEvent.DirectConnectionAction, {
      action: "updated",
      type: incomingSpec.formConnectionType,
      specifiedConnectionType: incomingSpec.specifiedConnectionType,
      withKafka: !!incomingSpec.kafka_cluster,
      withSchemaRegistry: !!incomingSpec.schema_registry,
      kafkaAuthType: getCredentialsType(incomingSpec.kafka_cluster?.credentials),
      kafkaSslEnabled: incomingSpec.kafka_cluster?.ssl?.enabled,
      schemaRegistryAuthType: getCredentialsType(incomingSpec.schema_registry?.credentials),
      schemaRegistrySslEnabled: incomingSpec.schema_registry?.ssl?.enabled,
    });

    // update the connection in secret storage (via full replace of the connection by its id)
    await getResourceManager().addDirectConnection(incomingSpec);
    return;
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
    dryRun: boolean = false,
  ): Promise<{ connection: Connection | null; errorMessage: string | null }> {
    let connection: Connection | null = null;
    let errorMessage: string | null = null;

    try {
      connection = update
        ? await tryToUpdateConnection(spec)
        : await tryToCreateConnection(spec, dryRun);
      const connectionId = connection.spec.id as ConnectionId;
      if (!dryRun) {
        window.withProgress(
          {
            location: ProgressLocation.Notification,
            title: `Waiting for "${connection.spec.name}" to be usable...`,
          },
          async () => {
            await waitForConnectionToBeStable(connectionId);
          },
        );
      }
    } catch (error) {
      // logging happens in the above call
      if (error instanceof ResponseError) {
        errorMessage = await error.response.clone().text();
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      const msg = `Failed to ${update ? "update" : dryRun ? "test" : "create"} connection. ${errorMessage}`;
      logger.error(msg);
      if (!dryRun) window.showErrorMessage(msg);
      errorMessage = msg;
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
      // kick off background checks to ensure the new connections are usable
      connectionIdsToCheck.map((id) => waitForConnectionToBeStable(id));
      logger.debug(
        `created and checked ${connectionIdsToCheck.length} new connection(s), firing event`,
      );
    }

    // rehydrate the websocket connection state watcher with the known connections to let it fire
    // off events as needed and determine connection stability, and also let any callers of the
    // watcher's `getLatestConnectionEvent` method get the latest connection status (e.g. if they
    // missed the initial event(s))
    const watcher = ConnectionStateWatcher.getInstance();
    sidecarDirectConnections.forEach((conn) => {
      watcher.cacheConnectionIfNeeded(conn);
    });
  }
}
