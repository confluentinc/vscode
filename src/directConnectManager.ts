import { randomUUID } from "crypto";
import {
  ConfigurationChangeEvent,
  Disposable,
  SecretStorage,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import {
  Connection,
  ConnectionSpec,
  ConnectionType,
  KafkaClusterConfig,
  ResponseError,
  SchemaRegistryConfig,
} from "./clients/sidecar";
import { getExtensionContext } from "./context/extension";
import { ContextValues, setContextValue } from "./context/values";
import { ExtensionContextNotSetError } from "./errors";
import { Logger } from "./logging";
import { ENABLE_DIRECT_CONNECTIONS } from "./preferences/constants";
import { tryToCreateConnection } from "./sidecar/connections";
import { getResourceManager } from "./storage/resourceManager";

const logger = new Logger("direct");

/**
 * Singleton class responsible for the following:
 * - watching for changes in the {@link ENABLE_DIRECT_CONNECTIONS} experimental setting and adjusting
 *   associated context value(s) to enable/disable actions
 * - creating connections via input from the webview form and updating the Resources view
 * - fetching connections from persistent storage and deconflicting with the sidecar
 * - deleting connections through actions on the Resources view
 */
export class DirectConnectionManager {
  /** Disposables belonging to this class to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: Disposable[] = [];

  private secrets: SecretStorage;

  // singleton instance to prevent multiple listeners and single source of connection management
  private static instance: DirectConnectionManager;
  private constructor() {
    const context = getExtensionContext();
    if (!context) {
      // need access to SecretStorage to manage connection secrets
      throw new ExtensionContextNotSetError("DirectConnectionManager");
    }
    this.secrets = context.secrets;
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

    await getResourceManager().addDirectConnection(spec);

    // TODO: refresh Resources view

    return { success, message: JSON.stringify(connection) };
  }

  async getConnections() {
    // TODO: implement this
  }

  async deleteConnection(id: string) {
    // TODO: implement this
  }
}
