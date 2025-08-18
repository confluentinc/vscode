import { Mutex } from "async-mutex";
import {
  Disposable,
  LogOutputChannel,
  TextDocument,
  TextDocumentChangeEvent,
  TextEditor,
  Uri,
  window,
  workspace,
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
import { DisposableCollection } from "../utils/disposables";
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

export const FLINKSQL_LANGUAGE_ID = "flinksql";

/**
 * Singleton class that handles Flink configuration settings and language client management.
 * - Listens for CCloud authentication events, flinksql language file open, settings changes
 * - Fetches and manages information about the active Editor's Flink compute pool resources
 * - Manages Flink SQL Language Client lifecycle & related settings
 */
export class FlinkLanguageClientManager extends DisposableCollection {
  private static instance: FlinkLanguageClientManager | null = null;
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
    super();

    // make sure we dispose the output channel when the manager is disposed
    const outputChannel: LogOutputChannel = getFlinkSQLLanguageServerOutputChannel();
    this.disposables.push(outputChannel);
    // Register all our event listeners
    this.disposables.push(...this.setEventListeners());

    // Survey currently open documents and track the Flink SQL ones.
    this.initializeDocumentTracking();
  }

  /**
   * Should we consider language serving for this sort of document?
   * Yes if language id is flinksql and the URI scheme is not flinkstatement (the readonly statements)
   */
  isAppropriateDocument(document: TextDocument): boolean {
    return document.languageId === FLINKSQL_LANGUAGE_ID && this.isAppropriateUri(document.uri);
  }

  /** Should we consider language serving for this sort of document URI? */
  isAppropriateUri(uri: Uri): boolean {
    // Just not FLINKSTATEMENT_URI_SCHEME, the one used for readonly statements
    // downloaded from the Flink Statements view. Be happy with, say,
    // "file" or "untitled" schemes.
    return uri.scheme !== FLINKSTATEMENT_URI_SCHEME;
  }

  /** Set up to track the appropriate documents open at instance construction (extension startup) time. */
  private initializeDocumentTracking(): void {
    workspace.textDocuments.forEach((doc) => {
      if (this.isAppropriateDocument(doc)) {
        this.trackDocument(doc.uri);
      }
    });
  }

  /**
   * Mark this document URI as one being tracked and needing
   * language serving.
   *
   * When the set of documents is empty, we will schedule a cleanup
   * of the language client after a delay.
   *
   * Callers must all ensure that the document is appropriate for Flink SQL language serving
   * prior to calling.
   *
   * See {@link untrackDocument} and {@link cleanupLanguageClient} for the cleanup logic.
   */
  public trackDocument(uri: Uri): void {
    const uriString = uri.toString();
    logger.trace(`Tracking Flink SQL document: ${uriString}`);
    this.openFlinkSqlDocuments.add(uriString);
    // Cancel any pending cleanup when a new document is tracked
    this.clearCleanupTimer();
  }

  public untrackDocument(uri: Uri): void {
    const uriString = uri.toString();
    const removed = this.openFlinkSqlDocuments.delete(uriString);
    if (removed) {
      logger.trace(`Untracking Flink SQL document: ${uriString}`);

      // If no more documents are open, schedule client cleanup
      if (this.openFlinkSqlDocuments.size === 0 && this.isLanguageClientConnected()) {
        logger.debug("Last Flink SQL document closed, scheduling language client cleanup");
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

  /**
   * Simulates a document change to trigger diagnostics on the server side. Is needed to get diagnostics
   * when opening a new document. Can be removed when the CCloud Flink Language Service has been updated.
   * @param doc The document to simulate changes for.
   * @returns A promise that resolves when the notification has been sent.
   */
  public async simulateDocumentChangeToTriggerDiagnostics(doc: TextDocument): Promise<void> {
    if (!this.languageClient) {
      logger.info("Can't simulate document change for non-existing language client.");
      return;
    }
    await this.languageClient.sendNotification("textDocument/didChange", {
      textDocument: {
        uri: doc.uri.toString() || "",
        version: doc.version,
      },
      contentChanges: [
        {
          text: doc.getText(),
        },
      ],
    });
  }

  // Event Handlers.

  /**
   * Handle changes to the metadata we store for a URI (the annotations we keep re/the document)
   * Codelens compute pool affects connection, catalog/db will be sent as LSP workspace config.
   *
   * At time of writing, the only metadata we store for any URIs is for Flink SQL documents,
   * (the compute pool id, catalog and database names), but in the future we may
   * store more metadata for other URIs, so this event handler only acts if the URI /
   * document is appropriate for Flink SQL language serving.
   */
  async uriMetadataSetHandler(uri: Uri): Promise<void> {
    logger.trace("uriMetadataSetEventHandler(): URI metadata set for", {
      uri: uri.toString(),
    });

    if (this.lastDocUri && uri.toString() === this.lastDocUri.toString()) {
      // If the metadata change affects what the websocket endpoint URL should be, then we
      // need to restart the language client with the new URL (changed whole cloud
      // provider / region).
      //
      // Otherwise just need to notify the language server of the new settings (say, new compute pool
      // or new default database or catalog in same provider+env+region).
      const settings = await this.getFlinkSqlSettings(uri);
      if (
        settings.computePoolId &&
        this.lastWebSocketUrl !== (await this.buildFlinkSqlWebSocketUrl(settings.computePoolId))
      ) {
        logger.debug(
          "uriMetadataSet: WebSocket URL needs changing, reinitializing language client with new URL",
        );
        await this.restartLanguageClient();
      } else {
        logger.debug(
          "uriMetadataSet: Document metadata change does not warrant new websocket URL. Notifying language server of minor configuration change.",
        );
        await this.notifyConfigChanged();
      }
    } else if (this.isAppropriateUri(uri)) {
      const doc = await workspace.openTextDocument(uri);
      if (this.isAppropriateDocument(doc)) {
        logger.trace("Flink SQL document metadata changed, possibly initializing language client");
        await this.maybeStartLanguageClient(uri);
      }
    }
  }

  ccloudConnectedHandler(connected: boolean): void {
    if (connected) {
      logger.trace("CCloud connected, checking for open Flink SQL documents");
      let flinkSqlDocUri: Uri | undefined = this.findOpenFlinkSqlDocumentUri();

      if (flinkSqlDocUri) {
        logger.trace("Found one, initializing language client");
        void this.maybeStartLanguageClient(flinkSqlDocUri);
      }
    } else {
      logger.info("CCloud auth session ended, stopping Flink language client");
      void this.cleanupLanguageClient();
    }
  }

  /**
   * Find and return the Uri of any currently open Flink SQL documents which may
   * need language serving.
   * This checks the active editor first, then all visible editors.
   * Returns undefined if no such document is found.
   */
  findOpenFlinkSqlDocumentUri(): Uri | undefined {
    // Check the active editor first
    const activeEditor = window.activeTextEditor;
    if (activeEditor && this.isAppropriateDocument(activeEditor.document)) {
      return activeEditor.document.uri;
    } else {
      // If not in the active editor, scan all the visible editors for a Flink SQL document
      const flinkSqlEditor = window.visibleTextEditors.find((editor) =>
        this.isAppropriateDocument(editor.document),
      );
      return flinkSqlEditor ? flinkSqlEditor.document.uri : undefined;
    }
  }

  /**
   * Event handler for {@link window.onDidChangeActiveTextEditor}, which fires after
   * when "active text editor" {@link window.activeTextEditor} changes, such as when
   * the user switches to a different editor tab.
   */
  async onDidChangeActiveTextEditorHandler(editor: TextEditor | undefined): Promise<void> {
    logger.trace("Active editor changed", {
      languageId: editor?.document.languageId,
      uri: editor?.document.uri.toString(),
    });
    if (editor && this.isAppropriateDocument(editor.document)) {
      logger.trace("Active editor changed to Flink SQL file, initializing language client");
      await this.maybeStartLanguageClient(editor.document.uri);
    }
  }

  /**
   * Event handler for {@link workspace.onDidOpenTextDocument}.
   *
   * If the document is Flink SQL and an appropriate URI scheme:
   *   * Ensure it is tracked in our set of open FlinkSQL documents
   *   * Maybe start up the language client if needed.
   *
   * From the event emitter documentation:
   *   * An event that is emitted when a {@link TextDocument text document} is opened or when the language id
   * of a text document {@link languages.setTextDocumentLanguage has been changed}.
   *
   *   * Note that The event is emitted before the {@link TextDocument document} is updated in the
   * {@link window.activeTextEditor active text editor}
   */
  async onDidOpenTextDocumentHandler(doc: TextDocument): Promise<void> {
    if (this.isAppropriateDocument(doc)) {
      logger.trace(`FlinkSQL document opened: ${doc.uri.toString()}`);

      // Add it to our set of tracked documents (if not there already)
      this.trackDocument(doc.uri);

      const activeEditor = window.activeTextEditor;
      // No-op if the document is not the active editor (let the active editor listener handle it)
      if (activeEditor && activeEditor.document.uri.toString() !== doc.uri.toString()) {
        return;
      } else {
        logger.trace("Initializing language client for changed active Flink SQL document");
        await this.maybeStartLanguageClient(doc.uri);
      }
    }
  }

  /**
   * Handle the closing of a text document, {@link workspace.onDidCloseTextDocument}
   * If the document is a Flink SQL file, we untrack it and possibly clean up the language client.
   */
  onDidCloseTextDocumentHandler(doc: TextDocument): void {
    if (this.isAppropriateDocument(doc)) {
      logger.trace(`FlinkSQL document closed: ${doc.uri.toString()}`);

      // Untrack the document when it is closed. Will possibly trigger cleanup if no more documents are open.
      this.untrackDocument(doc.uri);
    }
  }

  /**
   * Event handler for {@link workspace.onDidChangeTextDocument}.
   *
   * This is called when the text in a document changes, such as when the user types in the editor.
   * If the document is a Flink SQL file and has diagnostics, we clear them to avoid stale diagnostics, in
   * that the remote language server does not clear them automatically.
   */
  onDidChangeTextDocumentHandler(event: TextDocumentChangeEvent): void {
    if (!this.isAppropriateDocument(event.document)) {
      return;
    }

    const uriString = event.document.uri.toString();

    if (
      this.openFlinkSqlDocuments.has(uriString) &&
      this.languageClient?.diagnostics?.has(event.document.uri) &&
      // Make sure the change updated the content of the document. Otherwise, clearing diagnostics
      // won't make sense. We'll, for instance, see document change events without content changes
      // when saving the document.
      event.contentChanges.length > 0
    ) {
      logger.trace(`Clearing diagnostics for document: ${uriString}`);
      this.clearDiagnostics(event.document.uri);
    }
  }

  private setEventListeners(): Disposable[] {
    return [
      // Handlers for our codebase custom events  ...
      ccloudConnected.event(this.ccloudConnectedHandler.bind(this)),
      uriMetadataSet.event(this.uriMetadataSetHandler.bind(this)),

      // Handlers for VSCode builtin events ...
      workspace.onDidOpenTextDocument(this.onDidOpenTextDocumentHandler.bind(this)),
      workspace.onDidCloseTextDocument(this.onDidCloseTextDocumentHandler.bind(this)),
      workspace.onDidChangeTextDocument(this.onDidChangeTextDocumentHandler.bind(this)),
      window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditorHandler.bind(this)),
    ];
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
    // Set to whichever one wins!
    computePoolId = uriMetadata?.flinkComputePoolId ?? (FLINK_CONFIG_COMPUTE_POOL.value || null);
    currentDatabaseId = uriMetadata?.flinkDatabaseId ?? (FLINK_CONFIG_DATABASE.value || null);

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
   * Clear diagnostics for a specific document URI
   * This is used to clear diagnostics when the document is closed or when the language client is reinitialized
   * It prevents stale diagnostics from being shown in the editor
   * @param documentUri The URI of the document to clear diagnostics for
   */
  private clearDiagnostics(documentUri: Uri): void {
    if (this.languageClient?.diagnostics?.has(documentUri)) {
      logger.trace(`Clearing diagnostics for document: ${documentUri.toString()}`);
      this.languageClient.diagnostics.delete(documentUri);
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
   * @param uri The URI of the document to initialize the client for
   * @param restartRunningClient Whether to force reinitialization of the language client even if it's already running
   */
  public async maybeStartLanguageClient(uri?: Uri, restartRunningClient = false): Promise<void> {
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
          if (!restartRunningClient) {
            logger.trace("Language client already exists for this URI, skipping initialization");
            return;
          } else {
            logger.trace(
              "Language client is already running for this URI, but forcing reinitialization",
            );
          }
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

        if (
          this.isLanguageClientConnected() &&
          url === this.lastWebSocketUrl &&
          !restartRunningClient
        ) {
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

        // Clear any diagnostics for the previous document.
        if (this.lastDocUri) {
          this.clearDiagnostics(this.lastDocUri);
        }

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
          await this.notifyConfigChanged();
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
        // Trigger diagnostics for the active document if language client is available
        if (this.languageClient) {
          logger.trace(`Simulating change to ${uriStr} to trigger diagnostics`);
          for (const textDocument of workspace.textDocuments) {
            if (textDocument.uri.toString() === uriStr) {
              await this.simulateDocumentChangeToTriggerDiagnostics(textDocument);
            }
          }
        }
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
      // Enforce restart of language client
      await this.maybeStartLanguageClient(this.lastDocUri, true);
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
    super.dispose();

    this.clearCleanupTimer();
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
