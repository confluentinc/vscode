import { Disposable, WorkspaceConfiguration, commands, window, workspace } from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ContextValues, getContextValue } from "../context/values";
import { ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import {
  ENABLE_FLINK,
  FLINK_CONFIG_COMPUTE_POOL,
  FLINK_CONFIG_DATABASE,
} from "../preferences/constants";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { SIDECAR_PORT } from "../sidecar/constants";
import { initializeLanguageClient } from "./languageClient";

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
    this.registerListeners();
  }

  private registerListeners(): void {
    // Listen for user opening a Flink SQL file
    this.disposables.push(
      workspace.onDidOpenTextDocument(async (document) => {
        if (document.languageId === "flinksql") {
          logger.debug("Flink SQL file opened, checking for language client");
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
        if (e.affectsConfiguration("confluent.flink")) {
          if (this.languageClient) {
            await this.notifyConfigChanged();
          } else {
            await this.maybeStartLanguageClient();
          }
        }
      }),
    );

    // Monitor the Flink enabled setting
    this.disposables.push(
      workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(ENABLE_FLINK)) {
          const isFlinkEnabled = getContextValue(ContextValues.flinkEnabled);
          if (isFlinkEnabled) {
            await this.maybeStartLanguageClient();
          } else {
            logger.debug("Flink is disabled in settings, stopping language client");
            this.cleanupLanguageClient();
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
    logger.debug("pool/db =>", defaultPoolId, defaultDatabase);
    return {
      database: defaultDatabase,
      computePoolId: defaultPoolId,
    };
  }

  /** Verify that Flink is enabled + the compute pool id setting exists and is in an environment we know about */
  public async validateFlinkSettings(): Promise<boolean> {
    const isFlinkEnabled = getContextValue(ContextValues.flinkEnabled);
    if (!isFlinkEnabled) {
      logger.debug("Flink is not enabled in settings, skipping configuration prompt");
      return false;
    }
    const { computePoolId } = this.getFlinkSqlSettings();
    if (!computePoolId) {
      logger.debug("Flink compute pool not set");
      await this.promptChooseDefaultComputePool();
      return false;
    }

    logger.debug("Flink compute pool is:", computePoolId);
    const computeValid = await this.checkFlinkResourcesAvailability(computePoolId);
    if (!computeValid) {
      logger.debug("Flink compute pool is not valid, prompting user");
      await this.promptChooseDefaultComputePool();
      return false;
    }
    logger.debug("Flink compute pool is valid");
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
        logger.error("No organization ID found");
        return null;
      }

      // Find the environment containing this compute pool
      const environments = await getEnvironments();
      if (!environments || environments.length === 0) {
        logger.error("No environments found");
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

      logger.error(`Could not find environment containing compute pool ${computePoolId}`);
      return null;
    } catch (error) {
      logger.error("Error finding compute pool", error);
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
        logger.debug("Language client connection confirmed active");
        return;
      } else {
        logger.debug("Language client connection not active, stopping and reinitializing");
        await this.cleanupLanguageClient();
      }
    }
    // Otherwise, we need to check if the prerequisites are met
    const isFlinkEnabled = getContextValue(ContextValues.flinkEnabled);
    if (!isFlinkEnabled) {
      logger.debug("Flink is not enabled, not initializing language client");
      return;
    }
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
      logger.debug("Initializing Flink SQL language client");
      let url: string | undefined;
      if (this.lastWebSocketUrl && this.lastWebSocketUrl.includes(computePoolId)) {
        logger.debug("Using cached WebSocket URL for reconnection");
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

    // Try to initialize a new client
    try {
      logger.debug("Attempting to initialize new language client");
      await this.maybeStartLanguageClient();
      // Reset counter on successful reconnection
      this.reconnectCounter = 0;
    } catch (e) {
      logger.error(`Failed to reconnect: ${e}`);
      // Try again if we haven't reached max attempts
      if (this.reconnectCounter < this.MAX_RECONNECT_ATTEMPTS) {
        this.handleWebSocketDisconnect();
      }
    }
  }

  private async cleanupLanguageClient(): Promise<void> {
    try {
      if (this.languageClient) {
        logger.debug("Deleting language client private instance");
        await this.languageClient.dispose();
        this.languageClient = null;
      }
      if (this.lastWebSocketUrl) {
        logger.debug("Clearing cached WebSocket URL");
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
    logger.debug("Flink configuration changed");
    // We have a lang client, send the updated settings
    if (this.languageClient && this.isLanguageClientConnected()) {
      const { database, computePoolId } = this.getFlinkSqlSettings();
      if (!computePoolId) {
        logger.debug("No compute pool ID configured, not sending configuration update");
        return;
      }
      const poolInfo = await this.lookupComputePoolInfo(computePoolId);
      const environmentId = poolInfo?.environmentId;

      // Don't send with undefined settings, server will override existing settings with empty/undefined values
      if (environmentId && database && computePoolId) {
        logger.debug("Sending complete configuration to language server", {
          computePoolId,
          environmentId,
          database,
        });

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
    // if (this.hasPromptedForSettings) {
    //   logger.debug("Already prompted for Flink settings this session, skipping");
    //   return;
    // }
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
    logger.debug("Disposing FlinkLanguageClientManager");
    await this.cleanupLanguageClient();

    // Dispose all other disposables
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

export function initializeFlinkLanguageClientManager(): Disposable {
  return FlinkLanguageClientManager.getInstance();
}
