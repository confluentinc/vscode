import { Disposable, commands, window, workspace } from "vscode";
import { Logger } from "../logging";
import { getResourceManager } from "../storage/resourceManager";
import { ccloudAuthSessionInvalidated, ccloudConnected } from "../emitters";
import { ContextValues, getContextValue } from "../context/values";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";

const logger = new Logger("flink.flinkConfigurationManager");

/**
 * Singleton class that handles Flink configuration settings.
 * - Listens for CCloud authentication events, flinksql language file open, settings changes
 * - Prompts user to update Flink settings configuration (default compute pool, database)
 * - Fetches and manages Flink compute pool resources
 * - (Future: Handle Flink SQL Language Client(s) initialization & reconnect?)
 */
export class FlinkConfigurationManager implements Disposable {
  static instance: FlinkConfigurationManager | null = null;
  private disposables: Disposable[] = [];
  private hasPromptedForSettings = false;

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
        }
      }),
    );

    // Listen for CCloud authentication
    this.disposables.push(
      ccloudAuthSessionInvalidated.event(() => {
        logger.debug("CCloud auth session invalidated, resetting prompt state");
        this.hasPromptedForSettings = false;
      }),
      ccloudConnected.event(async () => {
        await this.validateFlinkSettings();
      }),
    );

    // Monitor Flink settings changes
    this.disposables.push(
      workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("confluent.flink")) {
          logger.debug("Flink configuration changed");
          await this.checkFlinkResourcesAvailability();
        }
      }),
    );
  }

  public async checkAuthenticationState(): Promise<void> {
    if (hasCCloudAuthSession()) {
      logger.debug("User is authenticated with CCloud, checking Flink settings");
      await this.validateFlinkSettings();
    } else {
      logger.debug("User is not authenticated with CCloud");
    }
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
    const config = workspace.getConfiguration("confluent.flink");
    const computePoolId = config.get<string>("computePoolId");
    const database = config.get<string>("database");

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

    const config = workspace.getConfiguration("confluent.flink");
    const computePoolId = config.get<string>("computePoolId");

    if (!computePoolId) {
      return;
    }

    try {
      // Load available compute pools to verify the configured pool exists
      const resourceManager = getResourceManager();
      const environments = await resourceManager.getCCloudEnvironments();

      // Check if the configured compute pool exists in any environment
      let poolFound = false;
      for (const env of environments) {
        if (env.flinkComputePools.some((pool) => pool.id === computePoolId)) {
          poolFound = true;
          break;
        }
      } //TODO NC: check if it's status is ok?? Not sure...

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
   * Show notification for user to select default compute pool, database
   */
  private async promptChooseDefaultComputePool(): Promise<void> {
    const selection = await window.showInformationMessage(
      "Choose your CCloud Flink Compute Pool and other defaults to quickly run & view Flink SQL queries.",
      "Update Flink Settings",
      "Cancel",
    );

    if (selection === "Update Flink Settings") {
      await commands.executeCommand("confluent.flink.configureFlinkDefaults");
    } else if (selection === "Cancel") {
      logger.info("Flink SQL configuration update cancelled");
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
