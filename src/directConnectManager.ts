import { randomUUID } from "crypto";
import type { Disposable, SecretStorageChangeEvent } from "vscode";
import { window } from "vscode";
import { type ConnectionSpec, ResponseError } from "./connections";
import { getExtensionContext } from "./context/extension";
import { DirectConnectionHandler } from "./connections/handlers/directConnectionHandler";
import { getCredentialsType } from "./directConnections/credentials";
import { hasCCloudDomain } from "./directConnections/utils";
import { directConnectionsChanged, environmentChanged } from "./emitters";
import { ExtensionContextNotSetError } from "./errors";
import { DirectResourceLoader, ResourceLoader } from "./loaders";
import { Logger } from "./logging";
import type { ConnectionId, EnvironmentId } from "./models/resource";
import { SecretStorageKeys } from "./storage/constants";
import type { CustomConnectionSpec, DirectConnectionsById } from "./storage/resourceManager";
import { getResourceManager } from "./storage/resourceManager";
import { getSecretStorage } from "./storage/utils";
import { logUsage, UserEvent } from "./telemetry/events";
import { DisposableCollection } from "./utils/disposables";

const logger = new Logger("directConnectManager");

/**
 * Singleton class responsible for the following:
 *   associated context value(s) to enable/disable actions
 * - creating connections via input from the webview form and updating the Resources view
 * - fetching connections from persistent storage
 * - deleting connections through actions on the Resources view
 * - firing events when the connection list changes or a specific connection is updated/deleted
 */
export class DirectConnectionManager extends DisposableCollection {
  // singleton instance to prevent multiple listeners and single source of connection management
  private static instance: DirectConnectionManager | null = null;
  private constructor() {
    super();
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
    // Register to call handleDirectConnectionsChanged() if the direct connections
    // key in SecretStorage changes, which happens when a direct connection is added, edited,
    // or deleted in the webview form, by either this or another workspace.
    const secretStoreChangeListener: Disposable = getSecretStorage().onDidChange(
      async ({ key }: SecretStorageChangeEvent) => {
        // watch for any cross-workspace (or self-made) direct connection additions/removals
        if (key === SecretStorageKeys.DIRECT_CONNECTIONS) {
          await this.handleSecretStoreDirectConnectionsChanged();
        }
      },
    );

    return [secretStoreChangeListener];
  }

  /**
   * Handle changes made to the direct connections in the SecretStorage, either from other
   * workspaces or changes that this workspace just performed.
   *
   * Reconciles the registered direct connection loaders with the current
   * direct connections in the SecretStorage, then fires the `directConnectionsChanged`
   * event.
   */
  private async handleSecretStoreDirectConnectionsChanged(): Promise<void> {
    const connections: DirectConnectionsById = await getResourceManager().getDirectConnections();

    // Ensure all DirectResourceLoader instances are up to date.

    // Part 1: ensure any new connections have registered loaders; if this isn't done, hopping
    // workspaces and attempting to focus on a direct connection-based resource will fail with
    // the `Unknown connection ID` error. And purge the cache of any existing loaders
    // so they can re-fetch the latest resources, which may have just been reconfigured.

    const existingDirectLoadersById: Map<ConnectionId, DirectResourceLoader> = new Map(
      ResourceLoader.directLoaders().map((loader) => [loader.connectionId, loader]),
    );

    const existingLoaderIds: ConnectionId[] = Array.from(existingDirectLoadersById.keys());

    // Either make new loaders for any connections that don't have one, or
    // purge the cache of existing loaders to ensure they re-fetch the latest resources next time
    // (may have been reconfigured, e.g. new kafka cluster or schema registry, or improved)
    for (const id of connections.keys()) {
      if (!existingDirectLoadersById.has(id)) {
        // Create a and register a new DirectResourceLoader for this connection ID.
        this.initResourceLoader(id);
      } else {
        // Get this preexisting loader to purge its cache, so it can re-fetch the latest resources. The
        // connection may have gained or lost kafka cluster or schema registry, or improved
        // the spelling of which. Alas we don't know if this connection was changed at all when
        // we get the change event, so we have to be conservative and purge the caches of any
        // existing direct loaders.

        // (Thought: If a DirectLoader were to snapshot the connection spec at construction or
        //  coarse resource loading time, then we would have the old spec version to compare
        //  against and could then only purge the cache if the spec changed.)
        const existingLoader = existingDirectLoadersById.get(id)!;
        await existingLoader.reset();
      }
    }

    // Part 2: remove any direct connections not in the secret storage to prevent
    // requests to orphaned resources/connections

    for (const id of existingLoaderIds) {
      if (!connections.has(id)) {
        logger.debug(
          `handleDirectConnectionsChanged() removing loader for ${id} as it no longer exists in SecretStorage`,
        );
        ResourceLoader.deregisterInstance(id);

        // Also inform the single-environment-oriented views that the environment has been deleted,
        // giving them notice to reset() themselves.
        environmentChanged.fire({
          id: id as unknown as EnvironmentId,
          wasDeleted: true,
        });
      }
    }

    // Inform the Resources view(s) to reconcile their knowledge of direct connections vs
    // either ResourceManager.getDirectConnections() or ResourceLoader.directLoaders().
    logger.debug("handleDirectConnectionsChanged() firing directConnectionsChanged event");
    directConnectionsChanged.fire();
  }

  /**
   * Create a new direct connection with the configurations provided from the webview form.
   * @see `src/directConnect.ts` for the form data processing.
   * @see `src/webview/direct-connection-form` for the form UI handling.
   */
  async createConnection(
    spec: CustomConnectionSpec,
    dryRun: boolean = false,
  ): Promise<{ success: boolean; errorMessage: string | null }> {
    let incomingSpec: ConnectionSpec = spec;
    // check for an existing ConnectionSpec
    const currentSpec: ConnectionSpec | null = await getResourceManager().getDirectConnection(
      spec.id,
    );
    if (dryRun && currentSpec) {
      incomingSpec.id = randomUUID() as ConnectionId; // dryRun must have unique ID
    }

    // Validate the connection
    const { errorMessage } = await this.validateConnection(incomingSpec);

    logUsage(UserEvent.DirectConnectionAction, {
      action: dryRun ? "tested" : "created",
      type: spec.formConnectionType,
      specifiedConnectionType: spec.specifiedConnectionType,
      withKafka: !!spec.kafkaCluster,
      withSchemaRegistry: !!spec.schemaRegistry,
      kafkaAuthType: getCredentialsType(spec.kafkaCluster?.credentials),
      schemaRegistryAuthType: getCredentialsType(spec.schemaRegistry?.credentials),
      hasCCloudDomain: hasCCloudDomain(spec.kafkaCluster) || hasCCloudDomain(spec.schemaRegistry),
    });

    if (!errorMessage && !dryRun) {
      // save the new connection in secret storage. This will then ultimately trigger
      // the directConnectionsChanged event listener when it changes the secret storage
      // key value.
      await getResourceManager().addDirectConnection(spec);
      // create a new ResourceLoader instance for managing the new connection's resources
      this.initResourceLoader(spec.id);
    }
    return { success: !errorMessage, errorMessage };
  }

  async deleteConnection(id: ConnectionId): Promise<void> {
    const resourceManager = getResourceManager();
    const spec: CustomConnectionSpec | null = await resourceManager.getDirectConnection(id);

    if (!spec) {
      // Wacky, shouldn't happen, but if it does, just log and return.
      logger.warn(`Tried to delete a direct connection with ID ${id}, but it does not exist.`);
      return;
    }

    // Deregistering the resource loader needs to happen before resourceManager.deleteDirectConnection(id),
    // which ends up rewriting the secret storage key, which then ultimately fires the
    // directConnectionsChanged event, whose observers may try to reconcile their knowledge
    // of loaders with current loaders.
    ResourceLoader.deregisterInstance(id);

    // Rewrite the secret storage key to remove the connection.
    await resourceManager.deleteDirectConnection(id);

    logUsage(UserEvent.DirectConnectionAction, {
      action: "deleted",
      type: spec.formConnectionType,
      specifiedConnectionType: spec?.specifiedConnectionType,
      withKafka: !!spec.kafkaCluster,
      withSchemaRegistry: !!spec.schemaRegistry,
      kafkaAuthType: getCredentialsType(spec.kafkaCluster?.credentials),
      kafkaSslEnabled: spec.kafkaCluster?.ssl?.enabled,
      schemaRegistryAuthType: getCredentialsType(spec.schemaRegistry?.credentials),
      schemaRegistrySslEnabled: spec.schemaRegistry?.ssl?.enabled,
      hasCCloudDomain: hasCCloudDomain(spec.kafkaCluster) || hasCCloudDomain(spec.schemaRegistry),
    });
  }

  async updateConnection(incomingSpec: CustomConnectionSpec): Promise<void> {
    // Validate the updated spec
    const { errorMessage } = await this.validateConnection(incomingSpec);
    if (errorMessage) {
      window.showErrorMessage(`Error: Failed to update connection. ${errorMessage}`);
      return;
    }

    logUsage(UserEvent.DirectConnectionAction, {
      action: "updated",
      type: incomingSpec.formConnectionType,
      specifiedConnectionType: incomingSpec.specifiedConnectionType,
      withKafka: !!incomingSpec.kafkaCluster,
      withSchemaRegistry: !!incomingSpec.schemaRegistry,
      kafkaAuthType: getCredentialsType(incomingSpec.kafkaCluster?.credentials),
      kafkaSslEnabled: incomingSpec.kafkaCluster?.ssl?.enabled,
      schemaRegistryAuthType: getCredentialsType(incomingSpec.schemaRegistry?.credentials),
      schemaRegistrySslEnabled: incomingSpec.schemaRegistry?.ssl?.enabled,
      hasCCloudDomain:
        hasCCloudDomain(incomingSpec.kafkaCluster) || hasCCloudDomain(incomingSpec.schemaRegistry),
    });

    // update the connection in secret storage (via full replace of the connection by its id)
    await getResourceManager().addDirectConnection(incomingSpec);
  }

  /**
   * Validate a connection spec using the DirectConnectionHandler.
   *
   * If validation fails, the `errorMessage` will be populated with the error message.
   * Otherwise, the `errorMessage` will be `null`.
   */
  private async validateConnection(spec: ConnectionSpec): Promise<{ errorMessage: string | null }> {
    let errorMessage: string | null = null;

    logger.debug("Starting validateConnection()");

    try {
      const handler = new DirectConnectionHandler(spec);
      const testResult = await handler.testConnection();
      if (!testResult.success) {
        errorMessage = testResult.error ?? "Connection test failed";
      }
    } catch (error) {
      if (error instanceof ResponseError) {
        errorMessage = await error.response.clone().text();
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      logger.error("Connection validation failed:", errorMessage);
    }

    logger.debug("Ending validateConnection()");
    return { errorMessage };
  }

  /**
   * Initialize a new {@link DirectResourceLoader} instance for the given connection ID.
   * @param id The unique identifier for the connection.
   */
  initResourceLoader(id: ConnectionId) {
    ResourceLoader.registerInstance(id, new DirectResourceLoader(id));
  }

  /**
   * Load stored connections from SecretStorage and ensure {@link DirectResourceLoader}
   * instances are available for each {@link ConnectionId}.
   */
  async rehydrateConnections() {
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();

    logger.debug(`rehydrating ${storedConnections.size} stored direct connection(s)`);

    // Create ResourceLoader instances for each stored connection
    for (const id of storedConnections.keys()) {
      this.initResourceLoader(id);
    }

    if (storedConnections.size > 0) {
      logger.debug(`initialized ${storedConnections.size} direct connection loader(s)`);
      // Fire event to notify views that connections are ready
      directConnectionsChanged.fire();
    }
  }
}
