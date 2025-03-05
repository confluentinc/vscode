import { randomUUID } from "crypto";
import { Disposable, ProgressLocation, SecretStorageChangeEvent, window } from "vscode";
import {
  Connection,
  ConnectionsList,
  ConnectionSpec,
  ConnectionsResourceApi,
  ConnectionType,
  instanceOfApiKeyAndSecret,
  instanceOfBasicCredentials,
  instanceOfScramCredentials,
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
   * @see `src/directConnect.ts` for the form data processing.
   * @see `src/webview/direct-connection-form` for the form UI handling.
   */
  async createConnection(
    spec: CustomConnectionSpec,
    dryRun: boolean = false,
  ): Promise<{ connection: Connection | null; errorMessage: string | null }> {
    let incomingSpec: ConnectionSpec = spec;
    // check for an existing ConnectionSpec - if this is a dryRun on the Edit form we need to get the secrets
    const currentSpec: ConnectionSpec | null = await getResourceManager().getDirectConnection(
      spec.id,
    );
    if (dryRun && currentSpec) {
      incomingSpec = mergeSecrets(currentSpec, spec);
      incomingSpec.id = randomUUID() as ConnectionId; // dryRun must have unique ID
    }
    const { connection, errorMessage } = await this.createOrUpdateConnection(
      incomingSpec,
      false,
      dryRun,
    );

    logUsage(UserEvent.DirectConnectionAction, {
      type: spec.formConnectionType,
      action: dryRun ? "tested" : "created",
      withKafka: !!spec.kafka_cluster,
      withSchemaRegistry: !!spec.schema_registry,
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
      type: spec?.formConnectionType,
      action: "deleted",
      withKafka: !!spec?.kafka_cluster,
      withSchemaRegistry: !!spec?.schema_registry,
    });

    ResourceLoader.deregisterInstance(id);
  }

  async updateConnection(incomingSpec: CustomConnectionSpec): Promise<void> {
    // at this point incoming spec has placeholder secrets... look up the associated ConnectionSpec
    const currentSpec: CustomConnectionSpec | null = await getResourceManager().getDirectConnection(
      incomingSpec.id,
    );
    if (!currentSpec) {
      logger.error("Direct connection not found in resources, can't update");
      return;
    }
    const updatedSpec: ConnectionSpec = mergeSecrets(currentSpec, incomingSpec);
    // tell the sidecar about the updated spec
    const { connection, errorMessage } = await this.createOrUpdateConnection(updatedSpec, true);
    if (errorMessage || !connection) {
      window.showErrorMessage(
        `Error: Failed to update connection. ${errorMessage ?? "No connection object returned"}`,
      );
      return;
    }

    logUsage(UserEvent.DirectConnectionAction, {
      type: currentSpec.formConnectionType,
      action: "updated",
      withKafka: !!updatedSpec.kafka_cluster,
      withSchemaRegistry: !!updatedSpec.schema_registry,
    });

    // combine the returned ConnectionSpec with the CustomConnectionSpec before storing
    // (spec comes first because the ConnectionSpec will try to override `id` as a string)
    const mergedSpec: CustomConnectionSpec = {
      ...updatedSpec,
      id: incomingSpec.id,
      formConnectionType: incomingSpec.formConnectionType,
    };
    // update the connection in secret storage (via full replace of the connection by its id)
    await getResourceManager().addDirectConnection(mergedSpec);
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

export function mergeSecrets(
  currentSpec: ConnectionSpec,
  incomingSpec: CustomConnectionSpec,
): ConnectionSpec {
  const incomingKafkaCreds = incomingSpec.kafka_cluster?.credentials;
  const currentKafkaCreds = currentSpec.kafka_cluster?.credentials;
  // if there are kafka credentials we need to check/replace the secrets
  if (incomingKafkaCreds) {
    if (instanceOfBasicCredentials(incomingKafkaCreds)) {
      if (incomingKafkaCreds.password === "fakeplaceholdersecrethere") {
        if (currentKafkaCreds && instanceOfBasicCredentials(currentKafkaCreds)) {
          incomingKafkaCreds.password = currentKafkaCreds.password;
        }
      }
    } else if (instanceOfApiKeyAndSecret(incomingKafkaCreds)) {
      if (incomingKafkaCreds.api_secret === "fakeplaceholdersecrethere") {
        if (currentKafkaCreds && instanceOfApiKeyAndSecret(currentKafkaCreds))
          incomingKafkaCreds.api_secret = currentKafkaCreds.api_secret;
      }
    } else if (instanceOfScramCredentials(incomingKafkaCreds)) {
      if (incomingKafkaCreds.scram_password === "fakeplaceholdersecrethere") {
        if (currentKafkaCreds && instanceOfScramCredentials(currentKafkaCreds))
          incomingKafkaCreds.scram_password = currentKafkaCreds.scram_password;
      }
    }
  }
  // if there are schema registry credentials we need to check/replace the secrets
  const incomingSchemaCreds = incomingSpec.schema_registry?.credentials;
  const currentSchemaCreds = currentSpec.schema_registry?.credentials;
  if (incomingSchemaCreds) {
    if (instanceOfBasicCredentials(incomingSchemaCreds)) {
      if (incomingSchemaCreds.password === "fakeplaceholdersecrethere") {
        if (currentSchemaCreds && instanceOfBasicCredentials(currentSchemaCreds))
          incomingSchemaCreds.password = currentSchemaCreds.password;
      }
    } else if (instanceOfApiKeyAndSecret(incomingSchemaCreds)) {
      if (incomingSchemaCreds.api_secret === "fakeplaceholdersecrethere") {
        if (currentSchemaCreds && instanceOfApiKeyAndSecret(currentSchemaCreds))
          incomingSchemaCreds.api_secret = currentSchemaCreds.api_secret;
      }
    }
  }

  // need to replace ssl.truststore.password, ssl.keystore.password, ssl.keystore.key_password (if they have a placeholder & we have a secret stored)
  const incomingKafkaTLS = incomingSpec.kafka_cluster?.ssl;
  const currentKafkaTLS = currentSpec.kafka_cluster?.ssl;
  if (incomingKafkaTLS) {
    if (
      incomingKafkaTLS.truststore?.password === "fakeplaceholdersecrethere" &&
      currentKafkaTLS?.truststore?.password
    ) {
      incomingKafkaTLS.truststore.password = currentKafkaTLS.truststore.password;
    }
    if (
      incomingKafkaTLS.keystore?.password === "fakeplaceholdersecrethere" &&
      currentKafkaTLS?.keystore?.password
    ) {
      incomingKafkaTLS.keystore.password = currentKafkaTLS.keystore.password;
    }
    if (
      incomingKafkaTLS.keystore?.key_password === "fakeplaceholdersecrethere" &&
      currentKafkaTLS?.keystore?.key_password
    ) {
      incomingKafkaTLS.keystore.key_password = currentKafkaTLS.keystore.key_password;
    }
  }

  const incomingSchemaTLS = incomingSpec.schema_registry?.ssl;
  const currentSchemaTLS = currentSpec.schema_registry?.ssl;
  if (incomingSchemaTLS) {
    if (
      incomingSchemaTLS.truststore?.password === "fakeplaceholdersecrethere" &&
      currentSchemaTLS?.truststore?.password
    ) {
      incomingSchemaTLS.truststore.password = currentSchemaTLS.truststore.password;
    }
    if (
      incomingSchemaTLS.keystore?.password === "fakeplaceholdersecrethere" &&
      currentSchemaTLS?.keystore?.password
    ) {
      incomingSchemaTLS.keystore.password = currentSchemaTLS.keystore.password;
    }
    if (
      incomingSchemaTLS.keystore?.key_password === "fakeplaceholdersecrethere" &&
      currentSchemaTLS?.keystore?.key_password
    ) {
      incomingSchemaTLS.keystore.key_password = currentSchemaTLS.keystore.key_password;
    }
  }
  const kafkaSslEnabled =
    incomingSpec.kafka_cluster?.ssl?.enabled ?? currentSpec.kafka_cluster?.ssl?.enabled ?? true;

  const schemaSslEnabled =
    incomingSpec.schema_registry?.ssl?.enabled ?? currentSpec.schema_registry?.ssl?.enabled ?? true;
  const mergedSpec: ConnectionSpec = {
    ...incomingSpec,
    kafka_cluster: incomingSpec.kafka_cluster && {
      ...incomingSpec.kafka_cluster,
      credentials: incomingKafkaCreds,
      ssl: { enabled: kafkaSslEnabled, ...currentKafkaTLS, ...incomingKafkaTLS },
    },
    schema_registry: incomingSpec.schema_registry && {
      ...incomingSpec.schema_registry,
      credentials: incomingSchemaCreds,
      ssl: { enabled: schemaSslEnabled, ...currentSchemaTLS, ...incomingSchemaTLS },
    },
  };
  return mergedSpec;
}
