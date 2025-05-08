import { Disposable, commands, window, workspace } from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ContextValues, getContextValue } from "../context/values";
import { ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { ENABLE_FLINK } from "../preferences/constants";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { SIDECAR_PORT } from "../sidecar/constants";
import {
  initializeLanguageClient,
  isLanguageClientConnected,
  languageClientRestartNeeded,
} from "./languageClient";

const logger = new Logger("flinkConfigManager");

export interface FlinkSqlSettings {
  database: string;
  computePoolId: string;
}

/**
 * Singleton class that handles Flink configuration settings.
 * - Listens for CCloud authentication events, flinksql language file open, settings changes
 * - Prompts user to update Flink settings configuration (default compute pool, database)
 * - Fetches and manages Flink compute pool resources
 * - WIP: Manage Flink SQL Language Client(s) lifecycle & settings
 */
export class FlinkConfigurationManager implements Disposable {
  private static instance: FlinkConfigurationManager | null = null;
  private disposables: Disposable[] = [];
  // private hasPromptedForSettings = false;
  private languageClient: LanguageClient | null = null;
  private lastWebSocketUrl: string | null = null;

  static getInstance(): FlinkConfigurationManager {
    if (!FlinkConfigurationManager.instance) {
      FlinkConfigurationManager.instance = new FlinkConfigurationManager();
    }
    return FlinkConfigurationManager.instance;
  }

  private constructor() {
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
          // if (workspace.textDocuments.some((doc) => doc.languageId === "flinksql")) { // TODO NC check it works !
          await this.maybeStartLanguageClient();
        } else {
          logger.debug("CCloud auth session invalidated, resetting client");
          this.maybeStopLanguageClient();
        }
      }),
    );

    // Monitor Flink settings changes
    this.disposables.push(
      workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("confluent.flink")) {
          await this.notifyConfigChanged();
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
            logger.debug("Flink was disabled, no further actions needed");
            this.maybeStopLanguageClient();
          }
        }
      }),
    );

    // Listen for WebSocket disconnection events and try to reconnect
    this.disposables.push(
      languageClientRestartNeeded.event(async () => {
        logger.info("Received language client restart event");
        if (this.lastWebSocketUrl) {
          logger.info(`Attempting to reconnect language client to ${this.lastWebSocketUrl}`);
          await this.maybeStartLanguageClient();
        } else {
          logger.warn("Cannot reconnect language client - no previous WebSocket URL stored");
        }
      }),
    );
  }

  private async notifyConfigChanged(): Promise<void> {
    logger.debug("Flink configuration changed");
    // await this.checkFlinkResourcesAvailability();

    // We have a lang client, send the updated settings
    if (this.languageClient) {
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

  public getFlinkSqlSettings(): FlinkSqlSettings {
    const config = workspace.getConfiguration("confluent.flink");
    return {
      database: config.get<string>("database", ""),
      computePoolId: config.get<string>("computePoolId", ""),
    };
  }

  public async validateFlinkSettings(): Promise<boolean> {
    // if (this.hasPromptedForSettings) {
    //   logger.debug("Already prompted for Flink settings this session, skipping");
    //   // return;
    // }
    const isFlinkEnabled = getContextValue(ContextValues.flinkEnabled);
    if (!isFlinkEnabled) {
      logger.debug("Flink is not enabled in settings, skipping configuration prompt");
      return false;
    }
    const { computePoolId, database } = this.getFlinkSqlSettings();
    // If default settings are missing, prompt the user
    if (!computePoolId) {
      logger.debug("Flink settings not fully configured");
      // await this.promptChooseDefaultComputePool(); // TODO NC where does this go now?
      // this.hasPromptedForSettings = true;
      return false;
    }

    logger.debug("Flink settings are configured", { computePoolId, database });
    const computeValid = await this.checkFlinkResourcesAvailability(computePoolId);
    if (!computeValid) {
      // logger.debug("Flink compute pool is not valid, prompting user");
      // await this.promptChooseDefaultComputePool();
      return false;
    }
    logger.debug("Flink compute pool is valid");
    return true;
  }
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
   * Finds compute pool information across all environments
   * @param computePoolId The ID of the compute pool to find
   * @returns Object containing pool info and environment, or null if not found
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
    // If we already have a client and it's healthy we're cool
    if (this.languageClient && isLanguageClientConnected()) {
      logger.debug("Language client connection confirmed active");
      return;
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
    // TODO NC: refactor to validate & return setting in one?
    if (!computePoolId || !isPoolOk) {
      logger.debug("No valid compute pool; not initializing language client");
      return;
    }

    try {
      logger.info("Initializing Flink SQL language client");
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
      // Initialize the client with the URL
      this.languageClient = await initializeLanguageClient(url);
      if (this.languageClient) {
        this.disposables.push(this.languageClient);
        logger.info("Flink SQL language client successfully initialized");
        // this.notifyConfigChanged(); // Send settings right away... or no?
      }
    } catch (error) {
      logger.error("Failed to initialize Flink SQL language client:", error);
    }
  }

  private async maybeStopLanguageClient(): Promise<void> {
    try {
      if (this.languageClient) {
        logger.debug("Stopping language client");
        await this.languageClient.stop();
        this.languageClient = null;
      }
      if (this.lastWebSocketUrl) {
        logger.debug("Clearing cached WebSocket URL");
        this.lastWebSocketUrl = null;
      }
    } catch (error) {
      logger.error("Error stopping language client:", error);
      return;
    }
  }

  /**
   * Show notification for user to select default compute pool, database
   */
  private async promptChooseDefaultComputePool(): Promise<void> {
    if (!hasCCloudAuthSession()) {
      return; // This method should not be called if not authenticated
    }
    const selection = await window.showInformationMessage(
      "Choose your CCloud Flink Compute Pool and other defaults to quickly run & view Flink SQL queries.",
      "Update Flink Settings",
    );

    if (selection === "Update Flink Settings") {
      await commands.executeCommand("confluent.flink.configureFlinkDefaults");
    }
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

export function initializeFlinkConfigManager(): Disposable {
  return FlinkConfigurationManager.getInstance();
}
