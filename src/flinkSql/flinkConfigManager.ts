import { Disposable, commands, window, workspace } from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ContextValues, getContextValue } from "../context/values";
import { ccloudAuthSessionInvalidated, ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { ENABLE_FLINK } from "../preferences/constants";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { SIDECAR_PORT } from "../sidecar/constants";
import { initializeLanguageClient } from "./languageClient";

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
  static instance: FlinkConfigurationManager | null = null;
  private disposables: Disposable[] = [];
  private hasPromptedForSettings = false;
  private languageClient: LanguageClient | null = null;

  static getInstance(): FlinkConfigurationManager {
    if (!FlinkConfigurationManager.instance) {
      FlinkConfigurationManager.instance = new FlinkConfigurationManager();
    }
    return FlinkConfigurationManager.instance;
  }

  private constructor() {
    this.registerListeners();
    // Check immediately in case we're already authenticated
    this.checkAuthenticationState();
  }

  private registerListeners(): void {
    // Listen for user opening a Flink SQL file
    this.disposables.push(
      workspace.onDidOpenTextDocument(async (document) => {
        if (document.languageId === "flinksql") {
          await this.validateFlinkSettings();
          await this.initLanguageClient();
        }
      }),
    );

    // Listen for CCloud authentication
    this.disposables.push(
      ccloudAuthSessionInvalidated.event(() => {
        logger.debug("CCloud auth session invalidated, resetting prompt state");
        this.hasPromptedForSettings = false;
        this.languageClient?.dispose();
        this.languageClient = null;
      }),
      ccloudConnected.event(async () => {
        await this.validateFlinkSettings();
        if (workspace.textDocuments.some((doc) => doc.languageId === "flinksql")) {
          this.initLanguageClient();
        }
      }),
    );

    // Monitor Flink settings changes
    this.disposables.push(
      workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("confluent.flink")) {
          await this.handleFlinkConfigChange();
        }
      }),
    );

    // Monitor the Flink enabled setting
    this.disposables.push(
      workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(ENABLE_FLINK)) {
          const isFlinkEnabled = getContextValue(ContextValues.flinkEnabled);
          if (isFlinkEnabled) {
            this.hasPromptedForSettings = false;
            await this.validateFlinkSettings();
                      } else {
            logger.debug("Flink was disabled, no further actions needed");
          }
        }
      }),
    );
  }

  private async handleFlinkConfigChange(): Promise<void> {
    logger.debug("Flink configuration changed");
    await this.checkFlinkResourcesAvailability();

    if (this.languageClient) {
      const { database, computePoolId } = this.getFlinkSqlSettings();
      if (!computePoolId) {
        logger.debug("No compute pool ID configured, not sending configuration update");
        return;
      }
      const poolInfo = await this.lookupComputePoolInfo(computePoolId);
      const environmentId = poolInfo?.environmentId;

      // Only send settings if all required settings are present otherwise server will delete existing settings
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

  public async checkAuthenticationState(): Promise<void> {
    if (hasCCloudAuthSession()) {
      logger.debug("User is authenticated with CCloud, checking Flink settings");
      await this.validateFlinkSettings();
    } else {
      logger.debug("User is not authenticated with CCloud");
    }
  }
  public getFlinkSqlSettings(): FlinkSqlSettings {
    const config = workspace.getConfiguration("confluent.flink");
    return {
      database: config.get<string>("database", ""),
      computePoolId: config.get<string>("computePoolId", ""),
    };
  }
  /** Verify if the user has the required settings
   * - If not, prompt the user to select at least default compute pool
   * - If flink disabled or already prompted, skip the prompt
   * - If the user has a compute pool set, see if it is OK
   */
  public async validateFlinkSettings(): Promise<void> {
    if (this.hasPromptedForSettings) {
      logger.debug("Already prompted for Flink settings this session, skipping");
      return;
    }
    const isFlinkEnabled = getContextValue(ContextValues.flinkEnabled);
    if (!isFlinkEnabled) {
      logger.debug("Flink is not enabled in settings, skipping configuration prompt");
      return;
    }
    const { computePoolId, database } = this.getFlinkSqlSettings();
    // If default settings are missing, prompt the user
    if (!computePoolId || !database) {
      // TODO NC: should we skip as long as compute pool set? Branch off for DB?
      logger.debug("Flink settings not fully configured, prompting user");
      await this.promptChooseDefaultComputePool();
      this.hasPromptedForSettings = true;
    } else {
      logger.debug("Flink settings are configured", { computePoolId, database });
      await this.checkFlinkResourcesAvailability();
    }
  }

  private async checkFlinkResourcesAvailability(): Promise<void> {
    if (!hasCCloudAuthSession()) {
      return; // This method should not be called if not authenticated
    }
    const { computePoolId } = this.getFlinkSqlSettings();
    if (!computePoolId) {
      return;
    }

    try {
      // Load available compute pools to verify the configured pool exists
      // const resourceManager = getResourceManager();
      const environments = await getEnvironments(); //resourceManager.getCCloudEnvironments();
      // Avoid warning if we haven't loaded the envs yet (happens if user already has setting on activation)
      if (!environments || environments.length === 0) {
        logger.debug("No CCloud environments found");
        return;
      }
      // Check if the configured compute pool exists in any environment
      let poolFound = false;
      for (const env of environments) {
        if (env.flinkComputePools.some((pool) => pool.id === computePoolId)) {
          poolFound = true;
          break;
        }
      }

      if (!poolFound) {
        logger.warn(
          `Configured Flink compute pool ${computePoolId} not found in available resources`,
        );
        window
          .showWarningMessage(
            `The configured Flink compute pool (${computePoolId}) is not available. Please check your configuration.`,
            "Update Flink Settings",
          )
          .then((selection) => {
            if (selection === "Update Flink Settings") {
              commands.executeCommand("confluent.flink.configureFlinkDefaults");
            }
          });
      }
    } catch (error) {
      logger.error("Error checking Flink resources availability", error);
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
    if (!computePoolId) {
      return null;
    }

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
    return `ws://localhost:${SIDECAR_PORT}/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=${region}&provider=${provider}&environmentId=${environmentId}&organizationId=${organizationId}`;
  }

  /**
   * Ensures the language client is initialized if prerequisites are met
   */
  private async initLanguageClient(): Promise<void> {
    if (this.languageClient) {
      await this.handleFlinkConfigChange();
      return;
    }

    const isFlinkEnabled = getContextValue(ContextValues.flinkEnabled);
    if (!isFlinkEnabled) {
      logger.debug("Flink is not enabled, not initializing language client");
      return;
    }

    if (!hasCCloudAuthSession()) {
      logger.debug("No CCloud auth session, not initializing language client");
      return;
    }

    const { computePoolId } = this.getFlinkSqlSettings();

    if (!computePoolId) {
      logger.debug("No compute pool ID configured, not initializing language client");
      return;
    }

    try {
      logger.info("Initializing Flink SQL language client");
      const url = await this.buildFlinkSqlWebSocketUrl(computePoolId).catch((error) => {
        logger.error("Failed to build WebSocket URL:", error);
        window.showErrorMessage(
          `Failed to initialize Flink SQL language client: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      });
      if (!url) return;
      this.languageClient = await initializeLanguageClient(url);
      if (this.languageClient) {
        this.disposables.push(this.languageClient);
        logger.info("Flink SQL language client successfully initialized");
        this.handleFlinkConfigChange(); //send settings right away
      }
    } catch (error) {
      logger.error("Failed to initialize Flink SQL language client:", error);
      window.showErrorMessage(
        `Failed to initialize Flink SQL language client: ${error instanceof Error ? error.message : String(error)}`,
      );
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
