import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { currentFlinkStatementsResourceChanged } from "../emitters";
import { CCLOUD_PRIVATE_NETWORK_ENDPOINTS } from "../extensionSettings/constants";
import { CCloudEnvironment } from "../models/environment";
import { showInfoNotificationWithButtons } from "../notifications";
import { flinkCcloudEnvironmentQuickPick } from "../quickpicks/environments";
import { FlinkStatementsViewProvider } from "../viewProviders/flinkStatements";

async function setFlinkStatementsEnvironmentCommand(item?: CCloudEnvironment): Promise<void> {
  // ensure whatever was passed in is a CCloudEnvironment; if not, prompt the user to pick one
  const env: CCloudEnvironment | undefined =
    item instanceof CCloudEnvironment
      ? item
      : await FlinkStatementsViewProvider.getInstance().withProgress(
          "Select Environment",
          flinkCcloudEnvironmentQuickPick,
        );
  if (!env) {
    return;
  }

  // Inform the Flink Statements view that the user has selected a new environment.
  // This will cause the view to repaint itself with the new environment's statements.
  currentFlinkStatementsResourceChanged.fire(env);

  // Focus the Flink Statements view.
  await vscode.commands.executeCommand("confluent-flink-statements.focus");
}

/** Sets the private network endpoint(s) for a specific Confluent Cloud environment. */
export async function setPrivateNetworkEndpointCommand(item: CCloudEnvironment): Promise<void> {
  if (!(item instanceof CCloudEnvironment)) {
    return;
  }
  const existingPrivateEndpoints: Record<string, string> = CCLOUD_PRIVATE_NETWORK_ENDPOINTS.value;
  const newEndpointsValue: string | undefined = await vscode.window.showInputBox({
    title: "Set Private Network Endpoint(s)",
    prompt: `Enter private network endpoint(s) for environment "${item.name}" (${item.id}), separated by commas.`,
    placeHolder: "endpoint1,endpoint2",
    value: existingPrivateEndpoints[item.id] || "",
    ignoreFocusOut: true,
  });
  if (newEndpointsValue === undefined) {
    return;
  }
  existingPrivateEndpoints[item.id] = newEndpointsValue.trim();
  await CCLOUD_PRIVATE_NETWORK_ENDPOINTS.update(existingPrivateEndpoints, true);

  void showInfoNotificationWithButtons(
    `Private network endpoint(s) for environment "${item.name}" (${item.id}) set to "${newEndpointsValue}"`,
    {
      ["Change For Environment"]: async () => await setPrivateNetworkEndpointCommand(item),
      ["View Settings"]: async () => {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          `@id:${CCLOUD_PRIVATE_NETWORK_ENDPOINTS.id}`,
        );
      },
    },
  );
}

export function registerEnvironmentCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.resources.ccloudenvironment.viewflinkstatements",
      setFlinkStatementsEnvironmentCommand,
    ),
    registerCommandWithLogging(
      "confluent.resources.ccloudEnvironment.setPrivateNetworkEndpoint",
      setPrivateNetworkEndpointCommand,
    ),
  ];
}
