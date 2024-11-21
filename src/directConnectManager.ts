import { randomUUID } from "crypto";
import { ConfigurationChangeEvent, Disposable, workspace, WorkspaceConfiguration } from "vscode";
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
import { directConnectionDeleted } from "./emitters";
import { ExtensionContextNotSetError } from "./errors";
import { Logger } from "./logging";
import { ENABLE_DIRECT_CONNECTIONS } from "./preferences/constants";
import { getSidecar } from "./sidecar";
import { tryToCreateConnection, tryToDeleteConnection } from "./sidecar/connections";
import { DirectConnectionsById, getResourceManager } from "./storage/resourceManager";
import { getResourceViewProvider } from "./viewProviders/resources";

const logger = new Logger("direct");

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
  private static instance: DirectConnectionManager;
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
          // toggle "Other" container visibility in the Resources view
          getResourceViewProvider().refresh();
        }
      },
    );
    return [settingsListener];
  }

  async createConnection(
    kafkaClusterConfig: KafkaClusterConfig | undefined,
    schemaRegistryConfig: SchemaRegistryConfig | undefined,
    name?: string,
  ) {
    const connectionId = randomUUID();
    const spec: ConnectionSpec = {
      id: connectionId,
      name: name ?? "New Connection",
      type: ConnectionType.Direct,
    };

    if (kafkaClusterConfig) {
      spec.kafka_cluster = kafkaClusterConfig;
    }
    if (schemaRegistryConfig) {
      spec.schema_registry = schemaRegistryConfig;
    }

    let connection: Connection | null = null;
    let success: boolean = false;
    try {
      connection = await tryToCreateConnection(spec);
      success = true;
      logger.debug("Successfully created direct connection:", { connection });
    } catch (error) {
      logger.error("Failed to create direct connection:", { error });
      let errorMessage = "";
      if (error instanceof ResponseError) {
        const errorBody = await error.response.clone().json();
        errorMessage = JSON.stringify(errorBody);
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      return { success: false, message: errorMessage };
    }

    // save the new connection in secret storage
    await getResourceManager().addDirectConnection(spec);
    // refresh the Resources view to load the new connection
    getResourceViewProvider().refresh();
    // TODO(shoup): fire emitter

    return { success, message: JSON.stringify(connection) };
  }

  async deleteConnection(id: string) {
    await Promise.all([getResourceManager().deleteDirectConnection(id), tryToDeleteConnection(id)]);
    // refresh the Resources view to remove the deleted connection
    getResourceViewProvider().refresh();
    directConnectionDeleted.fire(id);
  }

  /** Compare the known connections between our SecretStorage and the sidecar, then make updates as needed. */
  async reconcileSidecarConnections() {
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
      `looked up existing direct connections -> sidecar: ${sidecarDirectConnections.length}, stored: ${Object.keys(storedConnections).length}`,
    );

    // if there are any stored connections that the sidecar doesn't know about, create them
    const newConnectionPromises: Promise<Connection>[] = [];
    for (const [id, connectionSpec] of storedConnections.entries()) {
      if (!sidecarDirectConnections.find((conn) => conn.spec.id === id)) {
        logger.debug("telling sidecar about stored connection:", { id });
        newConnectionPromises.push(tryToCreateConnection(connectionSpec));
      }
    }

    if (newConnectionPromises.length > 0) {
      await Promise.all(newConnectionPromises);
      getResourceViewProvider().refresh();
    }
  }
}
