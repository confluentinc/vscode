import { Mutex } from "async-mutex";
import type { Disposable, TextDocument, TextEditor, Uri } from "vscode";
import { window, workspace } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { CloseEvent, ErrorEvent, MessageEvent } from "ws";
import { WebSocket } from "ws";
import { TokenManager } from "../auth/oauth2/tokenManager";
import { getCatalogDatabaseFromMetadata } from "../codelens/flinkSqlProvider";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { FLINKSTATEMENT_URI_SCHEME } from "../documentProviders/flinkStatement";
import { ccloudConnected, uriMetadataSet } from "../emitters";
import { logError } from "../errors";
import {
  FLINK_CONFIG_COMPUTE_POOL,
  FLINK_CONFIG_DATABASE,
  USE_INTERNAL_FETCHERS,
} from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { Logger, RotatingLogOutputChannel } from "../logging";
import type { CCloudEnvironment } from "../models/environment";
import type { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { SIDECAR_PORT } from "../sidecar/constants";
import { SecretStorageKeys, UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import type { UriMetadata } from "../storage/types";
import { getSecretStorage } from "../storage/utils";
import { logUsage, UserEvent } from "../telemetry/events";
import { DisposableCollection } from "../utils/disposables";
import { FLINK_SQL_LANGUAGE_ID } from "./constants";
import { sendAuthMessage } from "./flinkLspAuth";
import { createLanguageClientFromWebsocket } from "./languageClient";
import { buildFlinkLspUrl } from "./privateEndpointResolver";

const logger = new Logger("flinkSql.languageClient.FlinkLanguageClientManager");

export interface FlinkSqlSettings {
  computePoolId: string | null;
  databaseName: string | null;
  catalogName: string | null;
}

/**
 * Information about the compute pool that the user is using.
 * This is used to build the WebSocket URL for the language client.
 */
export interface ComputePoolInfo {
  organizationId: string;
  environmentId: string;
  region: string;
  provider: string;
}

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
  private readonly outputChannel: RotatingLogOutputChannel;

  static getInstance(): FlinkLanguageClientManager {
    if (!FlinkLanguageClientManager.instance) {
      FlinkLanguageClientManager.instance = new FlinkLanguageClientManager();
    }
    return FlinkLanguageClientManager.instance;
  }

  private constructor() {
    super();

    // create the output channel ({@link RotatingLogOutputChannel}) for the Flink Language Server
    // this will automatically be disposed when the manager is disposed
    this.outputChannel = new RotatingLogOutputChannel(
      "Confluent Flink SQL Language Server",
      `flink-language-server-${process.pid}`,
    );
    this.disposables.push(this.outputChannel);

    // Register all our event listeners
    this.disposables.push(...this.setEventListeners());

    // Survey currently open documents and track the Flink SQL ones.
    this.initializeDocumentTracking();
  }

  /**
   * The {@link RotatingLogOutputChannel} for the Flink Language Server.
   * This will be automatically created and disposed with the {@link FlinkLanguageClientManager}
   * @returns The {@link RotatingLogOutputChannel} for the Flink Language Server
   */
  getOutputChannel(): RotatingLogOutputChannel {
    return this.outputChannel;
  }

  /**
   * Should we consider language serving for this sort of document?
   * Yes if language id is flinksql and the URI scheme is not flinkstatement (the readonly statements)
   */
  isAppropriateDocument(document: TextDocument): boolean {
    return document.languageId === FLINK_SQL_LANGUAGE_ID && this.isAppropriateUri(document.uri);
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
      const poolInfo = await this.lookupComputePoolInfo(settings.computePoolId);
      if (poolInfo && this.lastWebSocketUrl !== this.buildFlinkSqlWebSocketUrl(poolInfo)) {
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

  private setEventListeners(): Disposable[] {
    return [
      // Handlers for our codebase custom events  ...
      ccloudConnected.event(this.ccloudConnectedHandler.bind(this)),
      uriMetadataSet.event(this.uriMetadataSetHandler.bind(this)),

      // Handlers for VSCode builtin events ...
      workspace.onDidOpenTextDocument(this.onDidOpenTextDocumentHandler.bind(this)),
      workspace.onDidCloseTextDocument(this.onDidCloseTextDocumentHandler.bind(this)),
      window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditorHandler.bind(this)),
    ];
  }

  /** Get the document OR global/workspace settings for Flink, if any */
  public async getFlinkSqlSettings(uri: Uri): Promise<FlinkSqlSettings> {
    let computePoolId: string | null = null;
    let currentDatabaseName: string | null = null;
    let catalogName: string | null = null;
    let databaseName: string | null = null;

    // First, does the doc have this metadata set?
    const rm = ResourceManager.getInstance();
    const uriMetadata: UriMetadata | undefined = await rm.getUriMetadata(uri);
    // If not, does the workspace have a default set?
    // Set to whichever one wins!
    computePoolId =
      uriMetadata?.[UriMetadataKeys.FLINK_COMPUTE_POOL_ID] ??
      (FLINK_CONFIG_COMPUTE_POOL.value || null);
    currentDatabaseName =
      uriMetadata?.[UriMetadataKeys.FLINK_DATABASE_NAME] ?? (FLINK_CONFIG_DATABASE.value || null);

    // Look up the cluster & db name if we have a database id
    if (currentDatabaseName) {
      try {
        const settings = await getCatalogDatabaseFromMetadata(uriMetadata);
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
  private async lookupComputePoolInfo(
    computePoolId: string | null,
  ): Promise<ComputePoolInfo | null> {
    if (!computePoolId) {
      logger.trace("No compute pool id provided");
      return null;
    }

    try {
      // Load available compute pools to verify the configured pool exists
      const loader = CCloudResourceLoader.getInstance();
      // Get the current org
      const currentOrg = await loader.getOrganization();
      const organizationId: string | undefined = currentOrg?.id;
      if (!organizationId) {
        logger.trace("No organization found");
        return null;
      }

      // Find the environment containing this compute pool
      const environments: CCloudEnvironment[] = await loader.getEnvironments();
      if (!environments || environments.length === 0) {
        logger.trace("No CCloud environments found");
        return null;
      }
      // Check if the configured compute pool exists in any environment
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
   * Builds the WebSocket URL for the Flink SQL Language Server.
   * When USE_INTERNAL_FETCHERS is enabled, connects directly to CCloud.
   * Otherwise, connects through the sidecar.
   * @param poolInfo The compute pool info to use
   * @returns (string) WebSocket URL, or null if pool info is invalid
   */
  private buildFlinkSqlWebSocketUrl(poolInfo: ComputePoolInfo | null): string | null {
    if (!poolInfo) {
      logger.trace("No pool info provided, cannot build WebSocket URL");
      return null;
    }

    // Check if we should use direct connection to CCloud
    if (USE_INTERNAL_FETCHERS.value) {
      logger.debug("Using direct Flink LSP connection (USE_INTERNAL_FETCHERS enabled)");
      return buildFlinkLspUrl(poolInfo.environmentId, poolInfo.region, poolInfo.provider);
    }

    // Default: use sidecar proxy
    return `ws://localhost:${SIDECAR_PORT}/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=${poolInfo.region}&provider=${poolInfo.provider}&environmentId=${poolInfo.environmentId}&organizationId=${poolInfo.organizationId}`;
  }

  /**
   * Checks if we're using direct connection mode (bypassing sidecar).
   */
  private isDirectConnectionMode(): boolean {
    return USE_INTERNAL_FETCHERS.value === true;
  }

  /**
   * Sub-function of {@link maybeStartLanguageClient} that checks prerequisites for starting a new language client.
   * Prerequisites for starting a new language client:
   * - User is authenticated with CCloud
   * - User has designated a compute pool to use (language server route is region+provider specific)
   * - User does not already have a language client running for this uri or need to force restart it
   * @param uri The URI of the document to check
   * @param restartRunningClient Whether to force reinitialization of the language client even if it's already running
   * @returns The compute pool ID, pool info, and WebSocket URL if the prerequisites are met, or null if they are not
   */
  private async checkClientPrerequisites(
    uri: Uri,
    restartRunningClient: boolean = false,
  ): Promise<{
    computePoolId: string;
    poolInfo: ComputePoolInfo;
    websocketUrl: string;
  } | null> {
    if (!hasCCloudAuthSession()) {
      logger.trace("User is not authenticated with CCloud, not initializing language client");
      return null;
    }

    // Check if we have a client for this URI and if we don't need to restart
    if (
      this.isLanguageClientConnected() &&
      this.lastDocUri &&
      uri.toString() === this.lastDocUri.toString()
    ) {
      if (!restartRunningClient) {
        logger.trace("Language client already exists for this URI, skipping initialization");
        return null;
      } else {
        logger.trace(
          "Language client is already running for this URI, but forcing reinitialization",
        );
      }
    }

    const { computePoolId } = await this.getFlinkSqlSettings(uri);
    if (!computePoolId) {
      logger.trace("No compute pool, not starting language client");
      return null;
    }

    const poolInfo = await this.lookupComputePoolInfo(computePoolId);
    if (!poolInfo) {
      logger.trace("No valid compute pool; not initializing language client");
      return null;
    }

    const websocketUrl = this.buildFlinkSqlWebSocketUrl(poolInfo);
    if (!websocketUrl) {
      logger.error("Failed to build WebSocket URL, cannot start language client");
      return null;
    }

    return { computePoolId, poolInfo, websocketUrl };
  }

  /**
   * Sub-function of {@link maybeStartLanguageClient} that clears diagnostics and initializes a new language client
   * @param uri The URI of the document to initialize the client for
   * @param computePoolId The ID of the compute pool to use
   * @param websocketUrl The WebSocket URL to use for the language client
   * @param poolInfo The compute pool info (needed for direct connection auth)
   */
  private async initializeNewClient(
    uri: Uri,
    computePoolId: string,
    websocketUrl: string,
    poolInfo: ComputePoolInfo,
  ): Promise<void> {
    // Cleanup logic
    logger.trace("Cleaning up and reinitializing", {
      clientConnected: this.isLanguageClientConnected(),
      lastWebSocketUrl: this.lastWebSocketUrl,
      websocketUrlMatch: websocketUrl === this.lastWebSocketUrl,
    });

    // Clear any previous diagnostics for the document *before*
    // reinitializing the language client. (cleanupLanguageClient()
    // will set this.lastDocUri to null, which will then prevent
    // the attempt to clear diagnostics before the call to
    // initializeLanguageClient().)
    if (this.lastDocUri) {
      this.clearDiagnostics(this.lastDocUri);
    }
    await this.cleanupLanguageClient();

    // Reset reconnect counter on new initialization
    this.reconnectCounter = 0;

    logger.debug(
      `Starting language client with URL: ${websocketUrl} for document ${uri.toString()}`,
    );
    this.languageClient = await this.initializeLanguageClient(websocketUrl, poolInfo);

    if (this.languageClient) {
      this.disposables.push(this.languageClient);
      this.lastDocUri = uri;
      this.lastWebSocketUrl = websocketUrl;

      logger.trace("Flink SQL language client successfully initialized");
      logUsage(UserEvent.FlinkSqlClientInteraction, {
        action: "client_initialized",
        compute_pool_id: computePoolId,
      });
      await this.notifyConfigChanged();
    }
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
  public async maybeStartLanguageClient(uri: Uri, restartRunningClient = false): Promise<void> {
    const uriStr = uri?.toString() || "undefined";
    logger.trace(`Requesting language client initialization for ${uriStr}`);
    // We use runExclusive to ensure only one initialization attempt at a time

    await this.clientInitMutex.runExclusive(async () => {
      try {
        logger.trace(`Acquired initialization lock for ${uriStr}`);

        // Step 1: Check prerequisites for starting a new client
        const prereqCheck = await this.checkClientPrerequisites(uri, restartRunningClient);
        if (!prereqCheck) {
          logger.trace("Prerequisites not met, not starting language client");
          return;
        }

        // Step 2: Check if client is already connected to the same WebSocket URL and doesn't need to force restart
        if (
          this.isLanguageClientConnected() &&
          prereqCheck.websocketUrl === this.lastWebSocketUrl &&
          !restartRunningClient
        ) {
          logger.trace("Language client already connected to correct url, no need to reinitialize");
          return;
        }

        // Step 3: Set up new client with valid prerequisites from {@link checkClientPrerequisites}
        await this.initializeNewClient(
          uri,
          prereqCheck.computePoolId,
          prereqCheck.websocketUrl,
          prereqCheck.poolInfo,
        );
      } catch (error) {
        // Should never happen, but if it does, we should log the error and continue
        logError(error, "Error in maybeStartLanguageClient", {
          extra: { uri: uri?.toString() },
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
   * For sidecar connections: waits for the "OK" message indicating the sidecar's connection
   * to CCloud is established.
   *
   * For direct connections: sends the auth message immediately after WebSocket opens,
   * then proceeds to create the language client.
   *
   * @param url The URL of the language server websocket
   * @param poolInfo The compute pool info (needed for direct connection auth)
   * @returns A promise that resolves to the language client, or null if initialization failed
   */
  private async initializeLanguageClient(
    url: string,
    poolInfo: ComputePoolInfo,
  ): Promise<LanguageClient | null> {
    const isDirectMode = this.isDirectConnectionMode();

    // Get the appropriate token based on connection mode
    let accessToken: string | null | undefined;
    if (isDirectMode) {
      // For direct connection, use data plane token from TokenManager
      accessToken = await TokenManager.getInstance().getDataPlaneToken();
      if (!accessToken) {
        const msg = "Failed to initialize Flink SQL language client: No data plane token available";
        logError(new Error(msg), "No data plane token in TokenManager");
        return null;
      }
    } else {
      // For sidecar connection, use the sidecar auth token from secret storage
      accessToken = await getSecretStorage().get(SecretStorageKeys.SIDECAR_AUTH_TOKEN);
      if (!accessToken) {
        const msg = "Failed to initialize Flink SQL language client: No access token found";
        logError(new Error(msg), "No token found in secret storage");
        return null;
      }
    }

    return new Promise((resolve, reject) => {
      let promiseHandled = false;

      const safeResolve = (value: LanguageClient | null) => {
        if (!promiseHandled) {
          promiseHandled = true;
          resolve(value);
        }
      };

      const safeReject = (error: Error) => {
        if (!promiseHandled) {
          promiseHandled = true;
          reject(error);
        }
      };

      const createClient = (ws: WebSocket) => {
        createLanguageClientFromWebsocket(
          ws,
          url,
          this.handleWebSocketDisconnect.bind(this),
          this.outputChannel,
        )
          .then((client) => {
            safeResolve(client);
          })
          .catch((e: Error) => {
            const msg = "Error while creating FlinkSQL language server";
            logError(e, msg, { extra: { wsUrl: url } });
            safeReject(e);
          });
      };

      logger.debug(`WebSocket connection in progress (direct mode: ${isDirectMode})`);

      const ws = new WebSocket(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });

      if (isDirectMode) {
        // Direct connection mode: send auth message on open, then create client
        ws.onopen = async () => {
          logger.debug("Direct WebSocket connection opened, sending auth message");
          try {
            await sendAuthMessage(
              ws,
              {
                region: poolInfo.region,
                provider: poolInfo.provider,
                environmentId: poolInfo.environmentId,
                organizationId: poolInfo.organizationId,
              },
              () => TokenManager.getInstance().getDataPlaneToken(),
            );
            logger.debug("Auth message sent, creating language client");
            createClient(ws);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logError(err, "Failed to send auth message to Flink LSP", { extra: { wsUrl: url } });
            safeReject(err);
            ws.close(1000, "Auth failed");
          }
        };
      } else {
        // Sidecar connection mode: wait for "OK" message, then create client
        const SIDECAR_PEER_CONNECTION_ESTABLISHED_MESSAGE = "OK";

        ws.onmessage = (event: MessageEvent) => {
          if (event.data === SIDECAR_PEER_CONNECTION_ESTABLISHED_MESSAGE) {
            logger.debug("Sidecar peer connection established, creating language client");
            ws.onmessage = null;
            createClient(ws);
          } else {
            logger.error(
              `Unexpected message received from WebSocket: ${JSON.stringify(event, null, 2)}`,
            );
            if (!promiseHandled) {
              safeReject(
                new Error(
                  `Unexpected message received from WebSocket instead of ${SIDECAR_PEER_CONNECTION_ESTABLISHED_MESSAGE}`,
                ),
              );
            }
          }
        };
      }

      ws.onerror = (error: ErrorEvent) => {
        const msg = "WebSocket error connecting to Flink SQL language server.";
        logError(error, msg, { extra: { wsUrl: url } });
        safeReject(new Error(`${msg}: ${error.message}`));
      };

      ws.onclose = (closeEvent: CloseEvent) => {
        logger.warn(
          `WebSocket connection closed: Code ${closeEvent.code}, Reason: ${closeEvent.reason}`,
        );

        if (!promiseHandled) {
          const context = isDirectMode ? "before auth completed" : 'before receiving "OK" message';
          logger.warn(`WebSocket connection closed ${context}, rejecting initialization`);
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
    void this.restartLanguageClient();
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
        await this.languageClient.sendNotification("workspace/didChangeConfiguration", {
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
    // Includes cleans up of language server outputChannel log stream & channel
    super.dispose();

    this.clearCleanupTimer();
    this.openFlinkSqlDocuments.clear();
    FlinkLanguageClientManager.instance = null;
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
