import path from "path";
import * as vscode from "vscode";
import { CCloudResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import { CCloudFlinkComputePool } from "../../models/flinkComputePool";
import { CCloudKafkaCluster } from "../../models/kafkaCluster";
import { CloudProvider } from "../../models/resource";
import { showErrorNotificationWithButtons } from "../../notifications";
import { flinkDatabaseRegionsQuickPick } from "../../quickpicks/cloudProviderRegions";
import { flinkCcloudEnvironmentQuickPick } from "../../quickpicks/environments";
import { FlinkDatabaseViewProvider } from "../../viewProviders/flinkDatabase";
import { ArtifactUploadParams } from "./uploadArtifactOrUDF";

const logger = new Logger("commands/artifactUploadForm");

interface FormState {
  environment?: { id: string; name: string };
  cloudRegion?: { provider: string; region: string };
  selectedFile?: vscode.Uri;
  artifactName?: string;
  description?: string;
  documentationUrl?: string;
}

/**
 * Displays a quick pick series as a "form" to gather required fields from the user.
 * @param item Optional context item to pre-populate fields in the upload request. Sent when invoked from a context menu.
 * @returns A promise that resolves to the artifact upload parameters or undefined if canceled.
 */
export async function artifactUploadQuickPickForm(
  item?: CCloudKafkaCluster | CCloudFlinkComputePool | vscode.Uri,
): Promise<ArtifactUploadParams | undefined> {
  const state: FormState = {};
  const loader = CCloudResourceLoader.getInstance();
  const assignStateFromKnownResource = async (
    resource: CCloudKafkaCluster | CCloudFlinkComputePool,
  ) => {
    state.cloudRegion = { provider: resource.provider, region: resource.region };
    // Only call getEnvironment if we do not already have this environment in state
    // Starting upload from right-clicking on Flink database cluster will override the selectedFlinkDatabase env
    if (!state.environment || state.environment.id !== resource.environmentId) {
      try {
        const env = await loader.getEnvironment(resource.environmentId);
        if (env) {
          state.environment = {
            id: env.id,
            name: env.name,
          };
        }
      } catch (error) {
        logger.error("Error fetching environment for form, will default to undefined", error);
      }
    }
  };
  // If there is a selected Flink database, pre-select the environment and cloud/region.
  const selectedFlinkDatabase = FlinkDatabaseViewProvider.getInstance().database;
  if (selectedFlinkDatabase) {
    await assignStateFromKnownResource(selectedFlinkDatabase);
  }

  // Pre-populate state from item if provided (invoked from context menu)
  if (item) {
    if (item instanceof CCloudFlinkComputePool || item instanceof CCloudKafkaCluster) {
      logger.debug("Pre-populating upload form with provided context", {
        environment: item.environmentId,
        cloud: item.provider,
        region: item.region,
      });
      await assignStateFromKnownResource(item);
    } else if (item instanceof vscode.Uri) {
      state.selectedFile = item;
      state.artifactName = path.basename(item.fsPath, path.extname(item.fsPath));
    }
  }

  const completedIcon = "pass-filled";
  const incompleteIcon = "circle-large-outline";

  const createMenuItems = () => [
    {
      label: `1. Select Environment`,
      description: state.environment
        ? `${state.environment.name} (${state.environment.id})`
        : "Not selected",
      iconPath: new vscode.ThemeIcon(state.environment ? completedIcon : incompleteIcon),
      value: "environment",
    },
    {
      label: `2. Select Cloud Provider & Region`,
      description: state.cloudRegion
        ? `${state.cloudRegion.provider} - ${state.cloudRegion.region}`
        : "Not selected",
      iconPath: new vscode.ThemeIcon(state.cloudRegion ? completedIcon : incompleteIcon),
      value: "cloudRegion",
    },
    {
      label: `3. Select JAR File`,
      description: state.selectedFile ? path.basename(state.selectedFile.fsPath) : "Not selected",
      iconPath: new vscode.ThemeIcon(state.selectedFile ? completedIcon : incompleteIcon),
      value: "file",
    },
    {
      label: `4. Artifact Name`,
      description: state.artifactName || "Not entered",
      iconPath: new vscode.ThemeIcon(state.artifactName ? completedIcon : incompleteIcon),
      value: "artifactName",
    },
    {
      label: `5. Description (Optional)`,
      description: state.description || "None",
      iconPath: new vscode.ThemeIcon(state.description ? completedIcon : incompleteIcon),
      value: "description",
    },
    {
      label: `6. Documentation URL (Optional)`,
      description: state.documentationUrl || "None",
      iconPath: new vscode.ThemeIcon(state.documentationUrl ? completedIcon : incompleteIcon),
      value: "documentationUrl",
    },
  ];

  while (true) {
    const menuItems = createMenuItems();
    const canComplete =
      state.environment && state.cloudRegion && state.selectedFile && state.artifactName;
    if (canComplete) {
      menuItems.push({
        label: "Upload Artifact",
        description: "All required fields provided",
        iconPath: new vscode.ThemeIcon("cloud-upload"),
        value: "complete",
      });
    }

    // Top-level quickpick. If user cancels here, we abort the entire flow
    const selection = await vscode.window.showQuickPick(menuItems, {
      title: "Upload Flink Artifact",
      placeHolder: "Select a step to provide details",
      ignoreFocusOut: true,
    });
    if (!selection) {
      return;
    }

    // Switch handles each (selected) step
    switch (selection.value) {
      case "environment": {
        const environment = await flinkCcloudEnvironmentQuickPick();
        if (environment) {
          state.environment = { id: environment.id, name: environment.name };
        }
        break;
      }

      case "cloudRegion": {
        const cloudRegion = await flinkDatabaseRegionsQuickPick((region) => region.cloud !== "GCP");
        if (cloudRegion) {
          state.cloudRegion = {
            provider: cloudRegion.provider,
            region: cloudRegion.region,
          };
        }
        break;
      }

      case "file": {
        const selectedFiles = await vscode.window.showOpenDialog({
          openLabel: "Select",
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            "Flink Artifact Files": ["jar"],
          },
        });
        if (selectedFiles && selectedFiles.length > 0) {
          state.selectedFile = selectedFiles[0];
          // populate artifact name from filename if not already set
          if (!state.artifactName) {
            state.artifactName = path.basename(
              state.selectedFile.fsPath,
              path.extname(state.selectedFile.fsPath),
            );
          }
        }
        break;
      }

      case "artifactName": {
        const defaultName = state.selectedFile
          ? path.basename(state.selectedFile.fsPath, path.extname(state.selectedFile.fsPath))
          : state.artifactName || "";

        const artifactName = await vscode.window.showInputBox({
          title: "Artifact Name",
          prompt: "Enter the artifact name",
          value: defaultName,
          ignoreFocusOut: true,
          validateInput: (value) =>
            value && value.trim() ? undefined : "Artifact name is required",
        });
        if (artifactName !== undefined) {
          state.artifactName = artifactName;
        }
        break;
      }

      case "description": {
        const description = await vscode.window.showInputBox({
          title: "Artifact Description",
          prompt: "Enter a description for the artifact (optional)",
          value: state.description || "",
          ignoreFocusOut: true,
        });
        if (description !== undefined) {
          state.description = description;
        }
        break;
      }

      case "documentationUrl": {
        const documentationUrl = await vscode.window.showInputBox({
          title: "Documentation URL",
          prompt: "Enter a documentation URL for the artifact (optional)",
          value: state.documentationUrl || "",
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (value && value.trim()) {
              try {
                new URL(value);
                return undefined;
              } catch {
                return "Please enter a valid URL";
              }
            }
            return undefined;
          },
        });
        if (documentationUrl !== undefined) {
          state.documentationUrl = documentationUrl;
        }
        break;
      }

      case "complete": {
        if (!canComplete) {
          vscode.window.showErrorMessage("Please complete all required fields before uploading.");
          continue;
        }

        // convert to CloudProvider enum
        let cloud: CloudProvider;
        if (state.cloudRegion!.provider === "AZURE") {
          cloud = CloudProvider.Azure;
        } else if (state.cloudRegion!.provider === "AWS") {
          cloud = CloudProvider.AWS;
        } else {
          // We are filitering GCP out of the pick list, so this should never happen, but it's here as a safeguard
          void showErrorNotificationWithButtons(
            `Upload Artifact cancelled: Unsupported cloud provider: ${state.cloudRegion!.provider}`,
          );
          continue;
        }

        // Our file picker and context menu filter on `.jar`, so this should be safe
        // When we add Python support we may want to make it more robust
        const fileFormat = state.selectedFile!.fsPath.split(".").pop() ?? "";

        return {
          environment: state.environment!.id,
          cloud,
          region: state.cloudRegion!.region,
          artifactName: state.artifactName!,
          fileFormat,
          selectedFile: state.selectedFile!,
          description: state.description,
          documentationUrl: state.documentationUrl,
        };
      }
    }
  }
}
