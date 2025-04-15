import * as vscode from "vscode";
import { IconNames } from "../constants";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";

export type envFilter = (env: CCloudEnvironment) => boolean;

export async function ccloudEnvironmentQuickPick(
  filter: envFilter | undefined,
): Promise<CCloudEnvironment | undefined> {
  // Convenience function to get the name of a cloud environment if a command was triggered through
  // the command palette instead of through the view->item->context menu
  if (!hasCCloudAuthSession()) {
    vscode.window.showInformationMessage("No Confluent Cloud connection found.");
    return undefined;
  }

  const allCcloudEnvironments: CCloudEnvironment[] =
    await CCloudResourceLoader.getInstance().getEnvironments();

  if (allCcloudEnvironments.length === 0) {
    vscode.window.showInformationMessage("No Confluent Cloud environments found.");
    return undefined;
  }

  // If a filter is provided, filter the environments
  let cloudEnvironments: CCloudEnvironment[] = filter
    ? allCcloudEnvironments.filter(filter)
    : allCcloudEnvironments;

  let environmentItems: vscode.QuickPickItem[] = [];
  // map the environment names to the CloudEnvironments themselves since we need to pass the ID
  // through to follow-on commands, but users will be more familiar with the names
  const environmentNameMap: Map<string, CCloudEnvironment> = new Map();
  cloudEnvironments.forEach((cloudEnvironment) => {
    environmentItems.push({
      label: cloudEnvironment.name,
      description: cloudEnvironment.id,
      iconPath: new vscode.ThemeIcon(IconNames.CCLOUD_ENVIRONMENT),
    });
    environmentNameMap.set(cloudEnvironment.name, cloudEnvironment);
  });

  // prompt the user to select an environment and return the corresponding CloudEnvironment
  const chosenEnvironment: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    environmentItems,
    {
      placeHolder: "Select an environment",
    },
  );
  return chosenEnvironment ? environmentNameMap.get(chosenEnvironment.label) : undefined;
}

/**
 * Quick pick for a CCloud environment from those which are Flink-enabled.
 * (As determined by the presence of Flink compute pool(s) for the time being until we know a better way)
 * @returns
 */
export async function flinkCcloudEnvironmentQuickPick(): Promise<CCloudEnvironment | undefined> {
  return await ccloudEnvironmentQuickPick((env) => {
    // Filter out environments that are not Flink compatible
    return env.flinkComputePools.length > 0;
  });
}
