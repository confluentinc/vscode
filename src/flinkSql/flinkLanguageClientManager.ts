import { Mutex } from "async-mutex";
import {
  Disposable,
  LogOutputChannel,
  TextDocument,
  TextEditor,
  Uri,
  window,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { CloseEvent, ErrorEvent, MessageEvent, WebSocket } from "ws";
import { getCatalogDatabaseFromMetadata } from "../codelens/flinkSqlProvider";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { FLINKSTATEMENT_URI_SCHEME } from "../documentProviders/flinkStatement";
import { ccloudConnected, uriMetadataSet } from "../emitters";
import { logError } from "../errors";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { SIDECAR_PORT } from "../sidecar/constants";
import { SecretStorageKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { UriMetadata } from "../storage/types";
import { getSecretStorage } from "../storage/utils";
import { logUsage, UserEvent } from "../telemetry/events";
import { createLanguageClientFromWebsocket } from "./languageClient";
import {
  clearFlinkSQLLanguageServerOutputChannel,
  getFlinkSQLLanguageServerOutputChannel,
} from "./logging";

const logger = new Logger("flinkSql.languageClient.FlinkLanguageClientManager");

export interface FlinkSqlSettings {
  computePoolId: string | null;
  databaseName: string | null;
  catalogName: string | null;
}

/**
 * Singleton class that handles Flink configuration settings and language client management.
 * - Listens for CCloud authentication events, flinksql language file open, settings changes
 * - Fetches and manages information about the active Editor's Flink compute pool resources
 * - Manages Flink SQL Language Client lifecycle & related settings
 */
export class FlinkLanguageClientManager implements Disposable {
  private static instance: FlinkLanguageClientManager | null = null;
  private disposables: Disposable[] = [];
  private languageClient: LanguageClient | null = null;
  private lastWebSocketUrl: string | null = null;
  private lastDocUri: Uri | null = null;
  private reconnectCounter = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 2;
  private readonly openFlinkSqlDocuments: Set<string> = new Set();
  private readonly clientInitMutex = new Mutex();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly CLEANUP_DELAY_MS = 60000; // 60 seconds

  static getInstance(): FlinkLanguageClientManager {
    if (!FlinkLanguageClientManager.instance) {
      FlinkLanguageClientManager.instance = new FlinkLanguageClientManager();
    }
    return FlinkLanguageClientManager.instance;
  }

  private constructor() {
    // make sure we dispose the output channel when the manager is disposed
    const outputChannel: LogOutputChannel = getFlinkSQLLanguageServerOutputChannel();
    this.disposables.push(outputChannel);
    this.initializeDocumentTracking();
    this.registerListeners();

    // This is true here when a user opens a new workspace after authenticating with CCloud in another one
    if (hasCCloudAuthSession()) {
      let flinkDoc: TextDocument | undefined = undefined;
      const activeEditor = window.activeTextEditor;
      // Check the active editor first
      if (activeEditor && activeEditor.document.languageId === "flinksql") {
        flinkDoc = activeEditor.document;
      } else {
        // If not active, scan all visible editors
        const flinkSqlEditor = window.visibleTextEditors.find(
          (editor) => editor.document.languageId === "flinksql",
        );
        if (flinkSqlEditor) {
          flinkDoc = flinkSqlEditor.document;
        }
      }

      if (flinkDoc) {
        logger.trace(
          "CCloud session already exists + found open Flink SQL document, initializing language client",
        );
        this.maybeStartLanguageClient(flinkDoc.uri);
      }
    }
  }

  private initializeDocumentTracking(): void {
    workspace.textDocuments.forEach((doc) => {
      if (doc.languageId === "flinksql" && doc.uri.scheme !== FLINKSTATEMENT_URI_SCHEME) {
        this.trackDocument(doc.uri);
      }
    });
  }

  public trackDocument(uri: Uri): void {
    if (uri.scheme !== FLINKSTATEMENT_URI_SCHEME) {
      const uriString = uri.toString();
      logger.trace(`Tracking Flink SQL document: ${uriString}`);
      this.openFlinkSqlDocuments.add(uriString);
      // Cancel any pending cleanup when a new document is tracked
      this.clearCleanupTimer();
    }
  }

  public untrackDocument(uri: Uri): void {
    const uriString = uri.toString();
    if (this.openFlinkSqlDocuments.has(uriString)) {
      logger.trace(`Untracking Flink SQL document: ${uriString}`);
      this.openFlinkSqlDocuments.delete(uriString);
      // If no more documents are open, schedule client cleanup
      if (this.openFlinkSqlDocuments.size === 0 && this.isLanguageClientConnected()) {
        logger.trace("Last Flink SQL document closed, scheduling language client cleanup");
        this.scheduleClientCleanup();
      }
    }
  }

  private scheduleClientCleanup(): void {
    this.clearCleanupTimer();
    this.cleanupTimer = setTimeout(async () => {
      logger.trace("Executing scheduled cleanup of language client after inactivity");
      // Only clean up if there are still no open documents
      if (this.openFlinkSqlDocuments.size === 0) {
        await this.cleanupLanguageClient();
        logUsage(UserEvent.FlinkSqlClientInteraction, {
          action: "client_auto_disposed",
          reason: "inactivity",
        });
      }
      this.cleanupTimer = null;
    }, this.CLEANUP_DELAY_MS);
  }

  private clearCleanupTimer(): void {
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.trace("Cleared scheduled language client cleanup timer");
    }
  }

  private registerListeners(): void {
    // Listen for changes to metadata
    // Codelens compute pool affects connection, catalog/db will be sent as LSP workspace config
    this.disposables.push(
      uriMetadataSet.event(async (uri: Uri) => {
        logger.trace("URI metadata set for", {
          uri: uri.toString(),
        });
        if (this.lastDocUri === uri) {
          this.notifyConfigChanged();
        } else if (uri && uri.scheme === "file") {
          const doc = await workspace.openTextDocument(uri);
          if (doc.languageId === "flinksql") {
            logger.trace("Flink SQL file opened, initializing language client");
            await this.maybeStartLanguageClient(uri);
          } else {
            logger.trace("Non-Flink SQL file opened, not initializing language client");
          }
        }
      }),
    );

    // Listen for active editor changes
    this.disposables.push(
      window.onDidChangeActiveTextEditor(async (editor: TextEditor | undefined) => {
        logger.trace("Active editor changed", {
          languageId: editor?.document.languageId,
          uri: editor?.document.uri.toString(),
        });
        if (
          editor &&
          editor.document.languageId === "flinksql" &&
          editor.document.uri.scheme !== FLINKSTATEMENT_URI_SCHEME // ignore readonly statement files
        ) {
          logger.trace("Active editor changed to Flink SQL file, initializing language client");
          await this.maybeStartLanguageClient(editor.document.uri);
        }
      }),
    );

    // Active editor should cover documents opening,
    // but we still listen for open event since it's also called when the language id changes
    this.disposables.push(
      workspace.onDidOpenTextDocument(async (doc) => {
        if (doc.languageId === "flinksql") {
          const activeEditor = window.activeTextEditor;
          // No-op if the document is not the active editor (let the active editor listener handle it)
          if (activeEditor && activeEditor.document.uri.toString() !== doc.uri.toString()) {
            return;
          } else {
            logger.trace("Initializing language client for changed active Flink SQL document");
            await this.maybeStartLanguageClient(doc.uri);
          }
        }
      }),
    );

    // Clear outdated diagnostics on document change; CCloud Flink SQL Server won't publish cleared diagnostics
    this.disposables.push(
      workspace.onDidChangeTextDocument((event) => {
        const uriString = event.document.uri.toString();
        if (uriString.startsWith("output:")) {
          return;
        }
        if (
          this.openFlinkSqlDocuments.has(uriString) &&
          this.languageClient?.diagnostics?.get(event.document.uri)
        ) {
          logger.trace(`Clearing diagnostics for document: ${uriString}`);
          this.languageClient.diagnostics.set(event.document.uri, []);
        } else {
          logger.trace(`Not clearing diagnostics for document: ${uriString}`);
        }
      }),
    );

    // Track documents being opened
    this.disposables.push(
      workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "flinksql" && doc.uri.scheme !== FLINKSTATEMENT_URI_SCHEME) {
          this.trackDocument(doc.uri);
        }
      }),
    );

    // Track documents being closed
    this.disposables.push(
      workspace.onDidCloseTextDocument((doc) => {
        if (doc.languageId === "flinksql") {
          this.untrackDocument(doc.uri);
        }
      }),
    );

    // Listen for CCloud authentication events
    this.disposables.push(
      ccloudConnected.event(async (connected) => {
        if (!connected) {
          logger.trace("CCloud auth session invalid, stopping Flink language client");
          this.cleanupLanguageClient();
        } else {
          logger.trace("CCloud connected, checking for open Flink SQL documents");
          let docUri: Uri | undefined;
          const activeEditor = window.activeTextEditor;
          if (
            activeEditor &&
            activeEditor.document.languageId === "flinksql" &&
            activeEditor.document.uri.scheme !== FLINKSTATEMENT_URI_SCHEME
          ) {
            // Prioritize the active document
            docUri = activeEditor.document.uri;
          } else if (this.openFlinkSqlDocuments.size > 0) {
            // Fall back to the first tracked document
            const firstDocUri = Array.from(this.openFlinkSqlDocuments)[0];
            docUri = Uri.parse(firstDocUri);
          }

          if (docUri) {
            await this.maybeStartLanguageClient(docUri);
          }
        }
      }),
    );
  }

  /** Get the document OR global/workspace settings for Flink, if any */
  public async getFlinkSqlSettings(uri: Uri): Promise<FlinkSqlSettings> {
    let computePoolId: string | null = null;
    let currentDatabaseId: string | null = null;
    let catalogName: string | null = null;
    let databaseName: string | null = null;

    // First, does the doc have this metadata set?
    const rm = ResourceManager.getInstance();
    const uriMetadata: UriMetadata | undefined = await rm.getUriMetadata(uri);
    // If not, does the workspace have a default set?
    const config: WorkspaceConfiguration = workspace.getConfiguration();
    // Set to whichever one wins!
    computePoolId = uriMetadata?.flinkComputePoolId ?? config.get(FLINK_CONFIG_COMPUTE_POOL, null);
    currentDatabaseId = uriMetadata?.flinkDatabaseId ?? config.get(FLINK_CONFIG_DATABASE, null);

    // Look up the cluster & db name if we have a database id
    if (currentDatabaseId) {
      try {
        const loader = CCloudResourceLoader.getInstance();
        // Get all clusters from all environments since we don't know which environment the cluster belongs to
        const environments = await loader.getEnvironments();
        const settings = await getCatalogDatabaseFromMetadata(uriMetadata, environments);
        if (settings) {
          catalogName = settings.catalog?.name || null;
          databaseName = settings.database?.name || null;
        }
      } catch (error) {
        logger.error("Error looking up Kafka cluster name", error);
      }
    }

    return {
      computePoolId,
      databaseName,
      catalogName,
    };
  }

  /** Verify that Flink is enabled + the compute pool id setting exists and is in an environment we know about */
  public async validateFlinkSettings(computePoolId: string | null): Promise<boolean> {
    if (!computePoolId) {
      return false;
    }
    try {
      // Load available compute pools to verify the configured pool exists
      // Find the environment containing this compute pool
      const loader = CCloudResourceLoader.getInstance();
      const environments: CCloudEnvironment[] = await loader.getEnvironments();
      if (!environments || environments.length === 0) {
        logger.trace("No CCloud environments found");
        return false;
      }
      // Check if the configured compute pool exists in any environment
      let poolFound = false;
      for (const env of environments) {
        if (env.flinkComputePools.some((pool) => pool.id === computePoolId)) {
          poolFound = true;
          break;
        }
      }

      if (poolFound) {
        return true;
      } else {
        logger.warn(
          `Configured Flink compute pool ${computePoolId} not found in available resources`,
        );
        return false;
      }
    } catch (error) {
      logger.error("Error checking Flink resources availability", error);
      return false;
    }
  }

  /**
   * Compiles compute pool details across all known environments
   * @param computePoolId The ID of the compute pool to look up
   * @returns Object {organizationId, environmentId, region, provider} or null if not found
   */
  private async lookupComputePoolInfo(computePoolId: string): Promise<{
    organizationId: string;
    environmentId: string;
    region: string;
    provider: string;
  } | null> {
    try {
      const loader = CCloudResourceLoader.getInstance();
      // Get the current org
      const currentOrg = await loader.getOrganization();
      const organizationId: string | undefined = currentOrg?.id;
      if (!organizationId) {
        return null;
      }

      // Find the environment containing this compute pool
      const environments: CCloudEnvironment[] = await loader.getEnvironments();
      if (!environments || environments.length === 0) {
        return null;
      }
      for (const env of environments) {
        const foundPool = env.flinkComputePools.find(
          (pool: CCloudFlinkComputePool) => pool.id === computePoolId,
        );
        if (foundPool) {
          return {
            organizationId,
            environmentId: env.id,
            region: foundPool.region,
            provider: foundPool.provider,
          };
        }
      }

      logger.warn(`Could not find environment containing compute pool ${computePoolId}`);
      return null;
    } catch (error) {
      let msg = "Error while looking up compute pool";
      logError(error, msg, {
        extra: {
          compute_pool_id: computePoolId,
        },
      });
      return null;
    }
  }

  /**
   * Builds the WebSocket URL for the Flink SQL Language Server
   * @param computePoolId The ID of the compute pool to use
   * @returns (string) WebSocket URL, or null if pool info couldn't be retrieved
   */
  private async buildFlinkSqlWebSocketUrl(computePoolId: string): Promise<string | null> {
    const poolInfo = await this.lookupComputePoolInfo(computePoolId);
    if (!poolInfo) {
      logger.error(`Could not find environment containing compute pool ${computePoolId}`);
      return null;
    }
    const { organizationId, environmentId, region, provider } = poolInfo;
    const url = `ws://localhost:${SIDECAR_PORT}/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=${region}&provider=${provider}&environmentId=${environmentId}&organizationId=${organizationId}`;
    return url;
  }

  /**
   * Ensures the language client is initialized if prerequisites are met
   * Prerequisites:
   * - User is authenticated with CCloud
   * - User has designated a compute pool to use (language server route is region+provider specific)
   * - User has opened a Flink SQL file
   */
  public async maybeStartLanguageClient(uri?: Uri): Promise<void> {
    const uriStr = uri?.toString() || "undefined";
    logger.trace(`Requesting language client initialization for ${uriStr}`);
    // We use runExclusive to ensure only one initialization attempt at a time
    await this.clientInitMutex.runExclusive(async () => {
      try {
        logger.trace(`Acquired initialization lock for ${uriStr}`);

        if (!hasCCloudAuthSession()) {
          logger.trace("User is not authenticated with CCloud, not initializing language client");
          return;
        }

        if (!uri) {
          logger.trace("No URI provided, cannot start language client");
          return;
        }

        // Check if we already have a client for this exact URI
        if (
          this.isLanguageClientConnected() &&
          this.lastDocUri &&
          uri.toString() === this.lastDocUri.toString()
        ) {
          logger.trace("Language client already exists for this URI, skipping initialization");
          return;
        }

        const { computePoolId } = await this.getFlinkSqlSettings(uri);
        if (!computePoolId) {
          logger.trace("No compute pool, not starting language client");
          return;
        }

        const isPoolOk = await this.validateFlinkSettings(computePoolId);
        if (!isPoolOk) {
          logger.trace("No valid compute pool; not initializing language client");
          return;
        }

        let url: string | null = await this.buildFlinkSqlWebSocketUrl(computePoolId).catch(
          (error) => {
            let msg = "Failed to build WebSocket URL";
            logError(error, msg, {
              extra: {
                compute_pool_id: computePoolId,
              },
            });
            return null;
          },
        );

        if (!url) {
          logger.error("Failed to build WebSocket URL, cannot start language client");
          return;
        }

        if (this.isLanguageClientConnected() && url === this.lastWebSocketUrl) {
          // If we already have a client, it's alive, the compute pool matches, so we're good
          logger.trace("Language client already connected to correct url, no need to reinitialize");
          return;
        } else {
          logger.trace("Cleaning up and reinitializing", {
            clientConnected: this.isLanguageClientConnected(),
            lastWebSocketUrl: this.lastWebSocketUrl,
            websocketUrlMatch: url === this.lastWebSocketUrl,
          });
          await this.cleanupLanguageClient();
        }

        // Reset reconnect counter on new initialization
        this.reconnectCounter = 0;
        logger.debug(`Starting language client with URL: ${url} for document ${uriStr}`);
        this.languageClient = await this.initializeLanguageClient(url);

        if (this.languageClient) {
          this.disposables.push(this.languageClient);
          this.lastDocUri = uri;
          this.lastWebSocketUrl = url;

          logger.trace("Flink SQL language client successfully initialized");
          logUsage(UserEvent.FlinkSqlClientInteraction, {
            action: "client_initialized",
            compute_pool_id: computePoolId,
          });
          this.notifyConfigChanged();
        }
      } catch (error) {
        let msg = "Error in maybeStartLanguageClient";
        logError(error, msg, {
          extra: {
            uri: uri?.toString(),
          },
        });
      } finally {
        logger.trace(`Released initialization lock for ${uriStr}`);
      }
    });
  }

  /**
   * Initialize the FlinkSQL language client and connect to the language server websocket.
   * Creates a WebSocket (ws), then on ws.onopen makes the WebsocketTransport class for server, and then creates the Client.
   * Provides middleware for completions and diagnostics in ClientOptions
   *
   * This method directly deals with the pre-language-server protocol 'OK' message from sidecar, indicating that the
   * connection to the CCloud Flink SQL language server is established, then refers the rest
   * of the initialization to {@link createLanguageClientFromWebsocket}.
   *
   * @param url The URL of the language server websocket
   * @returns A promise that resolves to the language client, or null if initialization failed
   */
  private async initializeLanguageClient(url: string): Promise<LanguageClient | null> {
    let accessToken: string | undefined = await getSecretStorage().get(
      SecretStorageKeys.SIDECAR_AUTH_TOKEN,
    );
    if (!accessToken) {
      let msg = "Failed to initialize Flink SQL language client: No access token found";
      logError(new Error(msg), "No token found in secret storage");
      return null;
    }
    return new Promise((resolve, reject) => {
      let promiseHandled = false;

      function safeResolve(value: LanguageClient | null) {
        if (!promiseHandled) {
          promiseHandled = true;
          resolve(value);
        }
      }

      function safeReject(error: Error) {
        if (!promiseHandled) {
          promiseHandled = true;
          reject(error);
        }
      }

      logger.debug(`WebSocket connection in progress`);

      const ws = new WebSocket(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });

      /**
       * Sidecar sends an "OK" message once its connection to CCloud Flink SQL language server is established.
       * We wait for this message *before* proceeding to create the language client to avoid in-between state errors
       * This message handler is short-lived and gets cleared out after we start the client
       */
      const SIDECAR_PEER_CONNECTION_ESTABLISHED_MESSAGE = "OK";

      ws.onmessage = (event: MessageEvent) => {
        if (event.data === SIDECAR_PEER_CONNECTION_ESTABLISHED_MESSAGE) {
          logger.debug("WebSocket peer connection established, creating language client");

          // Remove this message handler before proceeding to create the real language client.
          // This pre-LSP work is done and this layer of code should not handle any more messages.
          ws.onmessage = null;

          // Construct the real LSP client atop the WebSocket connection.
          createLanguageClientFromWebsocket(ws, url, this.handleWebSocketDisconnect.bind(this))
            .then((client) => {
              // Resolve initializeLanguageClient promise with the client
              safeResolve(client);
            })
            .catch((e: Error) => {
              let msg = "Error while creating FlinkSQL language server";
              logError(e, msg, {
                extra: {
                  wsUrl: url,
                },
              });
              // Reject initializeLanguageClient promise with the error from createLanguageClientFromWebsocket.
              safeReject(e);
            });
        } else {
          // We just got an unexpected message before the "OK" from the server, which should not
          // happen.
          logger.error(
            `Unexpected message received from WebSocket: ${JSON.stringify(event, null, 2)}`,
          );

          // If we haven't resolved yet, reject the promise.
          if (!promiseHandled) {
            safeReject(
              new Error(
                `Unexpected message received from WebSocket instead of ${SIDECAR_PEER_CONNECTION_ESTABLISHED_MESSAGE}`,
              ),
            );
          }
        }
      };

      ws.onerror = (error: ErrorEvent) => {
        let msg = "WebSocket error connecting to Flink SQL language server.";
        logError(error, msg, {
          extra: {
            wsUrl: url,
          },
        });
        safeReject(new Error(`${msg}: ${error.message}`));
      };

      ws.onclose = (closeEvent: CloseEvent) => {
        logger.warn(
          `WebSocket connection closed: Code ${closeEvent.code}, Reason: ${closeEvent.reason}`,
        );

        // if happens before we receive the "OK" message, we should reject the promise here.
        // (If happens after, we'll let the language client handle it. Perhaps we
        //  should have unwired this ws.onclose? Future experimentation will tell.)
        if (!promiseHandled) {
          logger.warn(
            `WebSocket connection closed before receiving "OK" message, rejecting initialization`,
          );
          safeReject(
            new Error(
              `WebSocket connection closed unexpectedly: ${closeEvent.reason} (Code: ${closeEvent.code})`,
            ),
          );
        }

        // 1000 is normal closure
        if (closeEvent.code !== 1000) {
          logError(
            new Error(`WebSocket closed unexpectedly: ${closeEvent.reason}`),
            "WebSocket onClose handler called",
            {
              extra: {
                closeEvent,
                wsUrl: url,
              },
            },
          );
        }
      };
    });
  }

  /**
   * Handle WebSocket disconnection events and attempt reconnection
   */
  private handleWebSocketDisconnect(): void {
    // Skip reconnection attempts if we're not authenticated
    if (!hasCCloudAuthSession()) {
      logger.warn("Not attempting reconnection: User not authenticated with CCloud");
      return;
    }

    // If we've reached max attempts, stop trying to reconnect
    if (this.reconnectCounter >= this.MAX_RECONNECT_ATTEMPTS) {
      let msg = `Failed to reconnect after ${this.MAX_RECONNECT_ATTEMPTS} attempts`;
      logError(new Error(msg), msg, {
        extra: {
          reconnectCounter: this.reconnectCounter,
          lastWebSocketUrl: this.lastWebSocketUrl,
        },
      });
      return;
    }

    logger.trace(
      `Attempting to reconnect websocket. (${this.reconnectCounter + 1}/${this.MAX_RECONNECT_ATTEMPTS})`,
    );
    this.reconnectCounter++;
    this.restartLanguageClient();
  }

  /**
   * Restart the language client
   */
  private async restartLanguageClient(): Promise<void> {
    if (!this.lastDocUri) return; // We should never get here
    try {
      await this.maybeStartLanguageClient(this.lastDocUri);
      // Reset counter on successful reconnection
      this.reconnectCounter = 0;
    } catch (e) {
      let msg = "Failed to restart language client";
      logError(e, msg, {
        extra: {
          reconnectCounter: this.reconnectCounter,
          lastWebSocketUrl: this.lastWebSocketUrl,
        },
      });
      if (this.reconnectCounter < this.MAX_RECONNECT_ATTEMPTS) {
        this.handleWebSocketDisconnect();
      }
    }
  }

  private async cleanupLanguageClient(): Promise<void> {
    this.clearCleanupTimer();
    try {
      if (this.languageClient) {
        await this.languageClient.dispose();
        this.languageClient = null;
      }
    } catch (error) {
      let msg = "Error stopping language client during cleanup";
      logError(error, msg);
    }
    // Make sure we clean up even if there's an error
    this.languageClient = null;
    this.lastDocUri = null;
    this.lastWebSocketUrl = null;
  }

  /** Verifies and sends workspace settings to the language server via
   * `workspace/didChangeConfiguration` notification
   */
  private async notifyConfigChanged(): Promise<void> {
    // We have a lang client, send the updated settings
    if (this.languageClient && this.lastDocUri && this.isLanguageClientConnected()) {
      const settings = await this.getFlinkSqlSettings(this.lastDocUri);
      if (!settings.computePoolId) {
        // No compute pool selected, can't send settings
        return;
      }

      // Don't send with undefined settings, server will override existing settings with empty/undefined values
      if (settings.databaseName && settings.computePoolId && settings.catalogName) {
        this.languageClient.sendNotification("workspace/didChangeConfiguration", {
          settings: {
            AuthToken: "{{ ccloud.data_plane_token }}",
            Catalog: settings.catalogName,
            Database: settings.databaseName,
            ComputePoolId: settings.computePoolId,
          },
        });
        logUsage(UserEvent.FlinkSqlClientInteraction, {
          action: "configuration_changed",
          hasComputePool: true,
          hasCatalog: true,
          hasDatabase: true,
        });
      } else {
        logger.trace("Incomplete settings, not sending configuration update", {
          hasComputePool: !!settings.computePoolId,
          hasCatalog: !!settings.catalogName,
          hasDatabase: !!settings.databaseName,
        });
      }
    }
  }
  /**
   * Checks if the language client is currently connected and healthy
   * @returns True if the client is connected, false otherwise
   */
  private isLanguageClientConnected(): boolean {
    return this.languageClient !== null && this.languageClient.isRunning() === true;
  }

  /**
   * Performs synchronous disposal operations to meet the Disposable interface
   * requirement, and initiates asynchronous cleanup.
   */
  public dispose(): void {
    // Start the async cleanup without waiting
    this.asyncDispose().catch((error) => {
      let msg = "Error during async language client cleanup";
      logError(error, msg);
    });

    // Immediately perform synchronous disposal operations
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];
    this.openFlinkSqlDocuments.clear();
    FlinkLanguageClientManager.instance = null;
    clearFlinkSQLLanguageServerOutputChannel();
    logger.trace("FlinkLanguageClientManager dispose initiated");
  }

  /**
   * Performs asynchronous cleanup operations.
   * Callers who need to wait for full cleanup can use this method directly.
   */
  public async asyncDispose(): Promise<void> {
    await this.cleanupLanguageClient();
    logger.trace("FlinkLanguageClientManager async cleanup completed");
  }
}

export function initializeFlinkLanguageClientManager(): Disposable {
  return FlinkLanguageClientManager.getInstance();
}
