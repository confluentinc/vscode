import {
  Disposable,
  LogOutputChannel,
  WorkspaceConfiguration,
  commands,
  window,
  workspace,
} from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import {
  ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER,
  FLINK_CONFIG_COMPUTE_POOL,
  FLINK_CONFIG_DATABASE,
} from "../preferences/constants";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { SIDECAR_PORT } from "../sidecar/constants";
import { initializeLanguageClient } from "./languageClient";
import {
  clearFlinkSQLLanguageServerOutputChannel,
  getFlinkSQLLanguageServerOutputChannel,
} from "./logging";

const logger = new Logger("flinkLanguageClientManager");

export interface FlinkSqlSettings {
  database: string;
  computePoolId: string;
}

/**
 * Singleton class that handles Flink configuration settings and language client management.
 * - Listens for CCloud authentication events, flinksql language file open, settings changes
 * - Prompts user to update Flink settings configuration (default compute pool, database)
 * - Fetches and manages Flink compute pool resources
 * - Manages Flink SQL Language Client lifecycle & settings
 */
export class FlinkLanguageClientManager implements Disposable {
  private static instance: FlinkLanguageClientManager | null = null;
  private disposables: Disposable[] = [];
  private hasPromptedForSettings = false;
  private languageClient: LanguageClient | null = null;
  private lastWebSocketUrl: string | null = null;
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
    // Listen for user opening a Flink SQL file
    this.disposables.push(
      workspace.onDidOpenTextDocument(async (document) => {
        if (document.languageId === "flinksql") {
          await this.maybeStartLanguageClient();
        }
      }),
    );

    // Listen for CCloud authentication
    this.disposables.push(
      ccloudConnected.event(async (connected) => {
        if (connected) {
          await this.maybeStartLanguageClient();
        } else {
          logger.debug("CCloud auth session invalid, stopping Flink language client");
          this.cleanupLanguageClient();
        }
      }),
    );

    // Monitor Flink settings changes
    this.disposables.push(
      workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER)) {
          // guard against any toggling of this setting, since its behavior is handled
          // at the `src/preferences/listener.ts` level
          return;
        }
        // real default settings changes
        if (e.affectsConfiguration("confluent.flink")) {
          if (this.languageClient) {
            await this.notifyConfigChanged();
          } else {
            await this.maybeStartLanguageClient();
          }
        }
      }),
    );
  }

  /** Get the global/workspace settings for Flink, if any */
  public getFlinkSqlSettings(): FlinkSqlSettings {
    const config: WorkspaceConfiguration = workspace.getConfiguration();
    const defaultPoolId: string = config.get(FLINK_CONFIG_COMPUTE_POOL, "");
    const defaultDatabase: string = config.get(FLINK_CONFIG_DATABASE, "");
    return {
      database: defaultDatabase,
      computePoolId: defaultPoolId,
    };
  }

  /** Verify that Flink is enabled + the compute pool id setting exists and is in an environment we know about */
  public async validateFlinkSettings(): Promise<boolean> {
    const { computePoolId } = this.getFlinkSqlSettings();
    if (!computePoolId) {
      await this.promptChooseDefaultComputePool();
      return false;
    }

    const computeValid = await this.checkFlinkResourcesAvailability(computePoolId);
    if (!computeValid) {
      await this.promptChooseDefaultComputePool();
      return false;
    }
    return true;
  }

  /** Does the compute pool id exist in an available ccloud environment? */
  private async checkFlinkResourcesAvailability(computePoolId: string): Promise<boolean> {
    try {
      // Load available compute pools to verify the configured pool exists
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
      const organizationId = currentOrg?.id ?? "";
      if (!organizationId) {
        return null;
      }

      // Find the environment containing this compute pool
      const environments = await getEnvironments();
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
  private async buildFlinkSqlWebSocketUrl(computePoolId: string): Promise<string> {
    const poolInfo = await this.lookupComputePoolInfo(computePoolId);
    if (!poolInfo) {
      throw new Error(`Could not find environment containing compute pool ${computePoolId}`);
    }
    const { organizationId, environmentId, region, provider } = poolInfo;
    const url = `ws://localhost:${SIDECAR_PORT}/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=${region}&provider=${provider}&environmentId=${environmentId}&organizationId=${organizationId}`;
    this.lastWebSocketUrl = url;
    return url;
  }

  /**
   * Ensures the language client is initialized if prerequisites are met
   * Prerequisites:
   * - User is authenticated with CCloud
   * - User has selected a compute pool to use for websocket connection (language server route is region/provider specific)
   * - User has opened a Flink SQL file
   * - User has not disabled Flink in settings
   */
  private async maybeStartLanguageClient(): Promise<void> {
    if (this.languageClient) {
      if (this.isLanguageClientConnected()) {
        // If we already have a client and it's healthy we're cool
        return;
      } else {
        logger.debug("Language client connection not active, stopping and reinitializing");
        await this.cleanupLanguageClient();
      }
    }
    // Otherwise, we need to check if the prerequisites are met
    if (!hasCCloudAuthSession()) {
      logger.debug("User is not authenticated with CCloud, not initializing language client");
      return;
    }
    const { computePoolId } = this.getFlinkSqlSettings();
    const isPoolOk = await this.validateFlinkSettings();
    if (!computePoolId || !isPoolOk) {
      logger.debug("No valid compute pool; not initializing language client");
      await this.promptChooseDefaultComputePool();
      return;
    }

    try {
      let url: string | undefined;
      if (this.lastWebSocketUrl && this.lastWebSocketUrl.includes(computePoolId)) {
        url = this.lastWebSocketUrl;
      } else {
        url = await this.buildFlinkSqlWebSocketUrl(computePoolId).catch((error) => {
          logger.error("Failed to build WebSocket URL:", error);
          return undefined;
        });
      }
      if (!url) return;

      // Reset reconnect counter on new initialization
      this.reconnectCounter = 0;

      this.languageClient = await initializeLanguageClient(url, () =>
        this.handleWebSocketDisconnect(),
      );
      if (this.languageClient) {
        this.disposables.push(this.languageClient);
        logger.debug("Flink SQL language client successfully initialized");
        this.notifyConfigChanged(); // Send settings right away
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
    // Dispose of the existing client if it exists
    await this.cleanupLanguageClient();
    try {
      await this.maybeStartLanguageClient();
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
      if (this.lastWebSocketUrl) {
        this.lastWebSocketUrl = null;
      }
    } catch (error) {
      logger.error("Error stopping language client:", error);
      // Make sure we clean up even if there's an error
      this.languageClient = null;
    }
  }

  /** Verifies and sends workspace settings to the language server via
   * `workspace/didChangeConfiguration` notification
   */
  private async notifyConfigChanged(): Promise<void> {
    // We have a lang client, send the updated settings
    if (this.languageClient && this.isLanguageClientConnected()) {
      const { database, computePoolId } = this.getFlinkSqlSettings();
      if (!computePoolId) {
        // No compute pool selected, don't send settings
        return;
      }
      const poolInfo = await this.lookupComputePoolInfo(computePoolId);
      const environmentId = poolInfo?.environmentId;

      // Don't send with undefined settings, server will override existing settings with empty/undefined values
      if (environmentId && database && computePoolId) {
        this.languageClient.sendNotification("workspace/didChangeConfiguration", {
          settings: {
            AuthToken: "{{ ccloud.data_plane_token }}",
            Catalog: environmentId,
            Database: database,
            ComputePoolId: computePoolId,
          },
        });
      } else {
        logger.debug("Incomplete settings, not sending configuration update", {
          hasComputePool: !!computePoolId,
          hasEnvironment: !!environmentId,
          hasDatabase: !!database,
        });
      }
    }
  }
  /**
   * Checks if the language client is currently connected and healthy
   * @returns True if the client is connected, false otherwise
   */
  private isLanguageClientConnected(): boolean {
    return this.languageClient !== null && this.languageClient.needsStart() === false;
  }

  /**
   * Show notification for user to select default compute pool, database
   */
  private async promptChooseDefaultComputePool(): Promise<void> {
    if (!hasCCloudAuthSession()) {
      return; // This method should not be called if not authenticated
    }
    const selection = await window.showInformationMessage(
      "Choose your default Flink compute pool & database to connect to the Flink SQL language server.",
      "Update Flink Settings",
    );

    if (selection === "Update Flink Settings") {
      await commands.executeCommand("confluent.flink.configureFlinkDefaults");
    }
    this.hasPromptedForSettings = true;
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
