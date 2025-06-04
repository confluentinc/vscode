import {
  Disposable,
  LogOutputChannel,
  TextEditor,
  Uri,
  window,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { FLINKSTATEMENT_URI_SCHEME } from "../documentProviders/flinkStatement";
import { ccloudConnected, uriMetadataSet } from "../emitters";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import { getEnvironments } from "../graphql/environments";
import { getCurrentOrganization } from "../graphql/organizations";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { SIDECAR_PORT } from "../sidecar/constants";
import { ResourceManager } from "../storage/resourceManager";
import { UriMetadata } from "../storage/types";
import { initializeLanguageClient } from "./languageClient";
import {
  clearFlinkSQLLanguageServerOutputChannel,
  getFlinkSQLLanguageServerOutputChannel,
} from "./logging";

const logger = new Logger("flinkLanguageClientManager");

export interface FlinkSqlSettings {
  databaseId: string | null;
  computePoolId: string | null;
}

/**
 * Singleton class that handles Flink configuration settings and language client management.
 * - Listens for CCloud authentication events, flinksql language file open, settings changes
 * - Fetches and manages Flink compute pool resources
 * - Manages Flink SQL Language Client lifecycle & settings
 */
export class FlinkLanguageClientManager implements Disposable {
  private static instance: FlinkLanguageClientManager | null = null;
  private disposables: Disposable[] = [];
  private languageClient: LanguageClient | null = null;
  private lastWebSocketUrl: string | null = null;
  private lastDocUri: Uri | null = null;
  private reconnectCounter = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 2;

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
    this.registerListeners();
  }

  private registerListeners(): void {
    // Listen for changes to metadata
    // Codelens compute pool affects connection, catalog/db will be sent as LSP workspace config
    this.disposables.push(
      uriMetadataSet.event(async (uri: Uri) => {
        logger.debug("URI metadata set for", {
          uri: uri.toString(),
        });
        if (this.lastDocUri === uri) {
          this.notifyConfigChanged();
        } else if (uri && uri.scheme === "file") {
          const doc = await workspace.openTextDocument(uri);
          if (doc.languageId === "flinksql") {
            logger.debug("Flink SQL file opened, initializing language client");
            await this.maybeStartLanguageClient(uri);
          } else {
            logger.debug("Non-Flink SQL file opened, not initializing language client");
          }
        }
      }),
    );

    // Listen for active editor changes
    this.disposables.push(
      window.onDidChangeActiveTextEditor(async (editor: TextEditor | undefined) => {
        logger.debug("Active editor changed", {
          languageId: editor?.document.languageId,
          uri: editor?.document.uri.toString(),
        });
        if (
          editor &&
          editor.document.languageId === "flinksql" &&
          editor.document.uri.scheme !== FLINKSTATEMENT_URI_SCHEME // ignore readonly statement files
        ) {
          logger.debug("Active editor changed to Flink SQL file, initializing language client");
          await this.maybeStartLanguageClient(editor.document.uri);
        }
      }),
    );

    // Listen for CCloud authentication
    this.disposables.push(
      ccloudConnected.event(async (connected) => {
        if (!connected) {
          logger.debug("CCloud auth session invalid, stopping Flink language client");
          this.cleanupLanguageClient();
        }
      }),
    );
  }

  /** Get the document OR global/workspace settings for Flink, if any */
  public async getFlinkSqlSettings(uri: Uri): Promise<FlinkSqlSettings> {
    let currentComputePoolId = null;
    let currentDatabase = null;
    // First, does the doc have this metadata set?
    const rm = ResourceManager.getInstance();
    const uriMetadata: UriMetadata | undefined = await rm.getUriMetadata(uri);
    // If not, does the workspace have a default set?
    const config: WorkspaceConfiguration = workspace.getConfiguration();

    // Set to whichever one wins!
    currentComputePoolId =
      uriMetadata?.flinkComputePoolId ?? config.get(FLINK_CONFIG_COMPUTE_POOL, null);

    currentDatabase = uriMetadata?.flinkDatabaseId ?? config.get(FLINK_CONFIG_DATABASE, null);

    return {
      databaseId: currentDatabase,
      computePoolId: currentComputePoolId,
    };
  }

  /** Verify that Flink is enabled + the compute pool id setting exists and is in an environment we know about */
  public async validateFlinkSettings(computePoolId: string | null): Promise<boolean> {
    if (!computePoolId) {
      return false;
    }
    try {
      // Load available compute pools to verify the configured pool exists
      // TOOD this can be done with ccloud resource loader?
      const environments = await getEnvironments();
      if (!environments || environments.length === 0) {
        logger.debug("No CCloud environments found");
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
      // Get the current org
      const currentOrg = await getCurrentOrganization();
      const organizationId: string | undefined = currentOrg?.id;
      if (!organizationId) {
        return null;
      }

      // Find the environment containing this compute pool
      const environments: CCloudEnvironment[] =
        await CCloudResourceLoader.getInstance().getEnvironments();

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
      logger.error("Error while looking up compute pool", error);
      return null;
    }
  }

  /**
   * Builds the WebSocket URL for the Flink SQL Language Server
   * @param computePoolId The ID of the compute pool to use
   * @returns (string) WebSocket URL, or Error if pool info couldn't be retrieved
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
    if (!hasCCloudAuthSession()) {
      logger.debug("User is not authenticated with CCloud, not initializing language client");
      return;
    }
    // TODO potential for improvement here: this is called from extensionSettings listener so uri may not be set, but we need it to start the client
    if (!uri) {
      logger.debug("No URI provided, cannot start language client");
      return;
    }

    const { computePoolId } = await this.getFlinkSqlSettings(uri);
    if (!computePoolId) {
      logger.debug("No compute pool, not starting language client");
      return;
    }
    const isPoolOk = await this.validateFlinkSettings(computePoolId);
    if (!isPoolOk) {
      logger.debug("No valid compute pool; not initializing language client");
      return;
    }

    let url: string | null = await this.buildFlinkSqlWebSocketUrl(computePoolId).catch((error) => {
      logger.error("Failed to build WebSocket URL:", error);
      return null;
    });
    if (!url) {
      logger.error("Failed to build WebSocket URL, cannot start language client");
      return;
    }
    if (this.isLanguageClientConnected() && url === this.lastWebSocketUrl) {
      // If we already have a client, it's alive, the compute pool matches, so we're good
      return;
    } else {
      logger.debug("Stopping client and reinitializing", {
        clientConnected: this.isLanguageClientConnected(),
        lastWebSocketUrl: this.lastWebSocketUrl,
        websocketUrlMatch: url === this.lastWebSocketUrl,
      });
      await this.cleanupLanguageClient();
    }

    try {
      // Reset reconnect counter on new initialization
      this.reconnectCounter = 0;
      this.languageClient = await initializeLanguageClient(url, () =>
        this.handleWebSocketDisconnect(),
      );
      if (this.languageClient) {
        this.disposables.push(this.languageClient);
        this.lastDocUri = uri;
        this.lastWebSocketUrl = url;
        logger.debug("Flink SQL language client successfully initialized");
        this.notifyConfigChanged();
      }
    } catch (error) {
      logger.error("Failed to initialize Flink SQL language client:", error);
    }
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
      logger.error(`Failed to reconnect after ${this.MAX_RECONNECT_ATTEMPTS} attempts`);
      return;
    }

    this.reconnectCounter++;
    this.restartLanguageClient();
  }

  /**
   * Restart the language client
   */
  private async restartLanguageClient(): Promise<void> {
    if (!this.lastDocUri) return; // We should never get here
    await this.cleanupLanguageClient();
    try {
      await this.maybeStartLanguageClient(this.lastDocUri);
      // Reset counter on successful reconnection
      this.reconnectCounter = 0;
    } catch (e) {
      logger.error(`Failed to reconnect: ${e}`);
      if (this.reconnectCounter < this.MAX_RECONNECT_ATTEMPTS) {
        this.handleWebSocketDisconnect();
      }
    }
  }

  private async cleanupLanguageClient(): Promise<void> {
    try {
      if (this.languageClient) {
        await this.languageClient.dispose();
        this.languageClient = null;
      }
    } catch (error) {
      logger.error("Error stopping language client:", error);
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
      const poolInfo = await this.lookupComputePoolInfo(settings.computePoolId);
      const environmentId = poolInfo?.environmentId;

      // Don't send with undefined settings, server will override existing settings with empty/undefined values
      if (environmentId && settings.databaseId && settings.computePoolId) {
        this.languageClient.sendNotification("workspace/didChangeConfiguration", {
          settings: {
            AuthToken: "{{ ccloud.data_plane_token }}",
            Catalog: environmentId,
            Database: settings.databaseId, // TODO better if we use names since it shows in diagnostics
            ComputePoolId: settings.computePoolId,
          },
        });
      } else {
        logger.debug("Incomplete settings, not sending configuration update", {
          hasComputePool: !!settings.computePoolId,
          hasEnvironment: !!environmentId,
          hasDatabase: !!settings.databaseId,
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

  public async dispose(): Promise<void> {
    await this.cleanupLanguageClient();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    FlinkLanguageClientManager.instance = null; // reset singleton instance to clear state
    clearFlinkSQLLanguageServerOutputChannel();
    logger.debug("FlinkLanguageClientManager disposed");
  }
}

export function initializeFlinkLanguageClientManager(): Disposable {
  return FlinkLanguageClientManager.getInstance();
}
