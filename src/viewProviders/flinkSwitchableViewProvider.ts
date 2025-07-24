import * as vscode from "vscode";
import { Logger } from "../logging";
import { FlinkArtifact } from "../models/flinkArtifact";
import { FlinkStatement } from "../models/flinkStatement";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkArtifactsViewProvider } from "./flinkArtifacts";
import { FlinkStatementsViewProvider } from "./flinkStatements";
import { ViewModeSwitchableProvider } from "./viewModeSwitchable";

type FlinkTreeItem = FlinkArtifact | FlinkStatement;

/**
 * A view provider that can switch between showing Flink artifacts and Flink statements.
 */
export class FlinkSwitchableViewProvider extends ViewModeSwitchableProvider<FlinkTreeItem> {
  public static readonly viewId = "confluent-flink";
  private logger = new Logger("viewProviders.flinkSwitchable");
  private treeView: vscode.TreeView<FlinkTreeItem>;

  constructor() {
    const artifactsProvider = FlinkArtifactsViewProvider.getInstance();
    const statementsProvider = FlinkStatementsViewProvider.getInstance();
    super(
      artifactsProvider as unknown as vscode.TreeDataProvider<FlinkTreeItem>,
      statementsProvider as unknown as vscode.TreeDataProvider<FlinkTreeItem>,
      "secondary", // default to statements
    );

    // Register the tree view
    this.treeView = vscode.window.createTreeView(FlinkSwitchableViewProvider.viewId, {
      treeDataProvider: this,
      showCollapseAll: true,
    });

    this.logger.debug(
      `FlinkSwitchableViewProvider created with mode: ${this.getMode()}, ` +
      `primaryProvider: ${artifactsProvider.constructor.name}, ` + 
      `secondaryProvider: ${statementsProvider.constructor.name}`
    );
    
    // Log the initial state of both providers
    this.logger.debug(
      `Initial provider state - ` +
      `artifactsProvider.resource: ${artifactsProvider.resource?.id ?? 'null'}, ` +
      `statementsProvider.resource: ${statementsProvider.resource?.id ?? 'null'}`
    );
    
    this.disposables.push(this.treeView);
  }

  /**
   * Override switchMode to handle specific refresh needs for Flink providers
   * @param mode The mode to switch to
   */
  public override switchMode(mode: "primary" | "secondary"): void {
    if (this.currentMode !== mode) {
      this.logger.info(`Switching view mode from ${this.currentMode} to ${mode}`);

      // Update the current mode
      this.currentMode = mode;

      // Get both providers
      const artifactsProvider = this.primaryProvider as unknown as FlinkArtifactsViewProvider;
      const statementsProvider = this.secondaryProvider as unknown as FlinkStatementsViewProvider;
      
      // Sync resources between providers when switching views
      if (mode === "primary" && statementsProvider.resource && !artifactsProvider.resource) {
        // When switching from statements to artifacts
        this.logger.info("Syncing compute pool from statements to artifacts provider");
        
        // Only set the resource if it's a compute pool (not an environment)
        if (statementsProvider.resource instanceof CCloudFlinkComputePool) {
          artifactsProvider.resource = statementsProvider.resource;
        } else {
          // If it's an environment, we can't use it for artifacts
          this.logger.warn(
            "Cannot sync resource: statements provider resource is not a compute pool",
            { resourceType: statementsProvider.resource?.constructor.name }
          );
          
          // Show a notification to the user
          vscode.window.showInformationMessage(
            "Flink Artifacts view requires a compute pool to be selected. Please select a compute pool from the Resources view."
          );
        }
      } else if (
        mode === "secondary" && 
        artifactsProvider.resource && 
        !statementsProvider.resource
      ) {
        // When switching from artifacts to statements
        this.logger.info("Syncing compute pool from artifacts to statements provider");
        
        // Artifacts provider can only have a compute pool, so it's always safe to assign
        statementsProvider.resource = artifactsProvider.resource;
      }
      
      // Get the provider that we're switching to
      const targetProvider = mode === "primary" ? artifactsProvider : statementsProvider;

      // Force a refresh of the target provider to load its data
      if (targetProvider && typeof targetProvider.refresh === "function") {
        this.logger.debug(`Refreshing ${mode} provider`);
        // Call refresh without parameters to use default behavior
        targetProvider.refresh();
      }

      // Call parent's method to fire the change event
      super.refresh();
    }
  }
}
