import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkDatabaseViewMode } from "../emitters";
import { isResponseError, logError } from "../errors";
import { CCloudResourceLoader } from "../loaders";
import { FlinkUdf } from "../models/flinkUDF";
import {
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
} from "../notifications";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

export async function setFlinkUDFViewModeCommand() {
  flinkDatabaseViewMode.fire(FlinkDatabaseViewProviderMode.UDFs);
  await setContextValue(ContextValues.flinkDatabaseViewMode, FlinkDatabaseViewProviderMode.UDFs);
}

/**
 * Delete a Flink UDF by executing a DROP FUNCTION statement.
 *
 * @param selectedUdf The UDF to delete
 */
export async function deleteFlinkUDFCommand(selectedUdf: FlinkUdf): Promise<void> {
  if (!selectedUdf) {
    return;
  }

  const confirmButton = "Yes, delete";
  const confirmResult = await vscode.window.showWarningMessage(
    `Are you sure you want to delete the UDF "${selectedUdf.name}"?`,
    { modal: true },
    confirmButton,
  );

  if (confirmResult !== confirmButton) {
    return;
  }

  try {
    const ccloudResourceLoader = CCloudResourceLoader.getInstance();
    const flinkDatabaseProvider = FlinkDatabaseViewProvider.getInstance();
    const database = flinkDatabaseProvider.resource;

    if (!database) {
      throw new Error("No Flink database.");
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Deleting Flink UDF",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Executing DROP FUNCTION statement..." });
        await ccloudResourceLoader.executeFlinkStatement<{ dropped_at?: string }>(
          `DROP FUNCTION \`${selectedUdf.name}\`;`,
          database,
          {
            nameSpice: "delete-udf",
            timeout: 30000, // 30 second timeout
          },
        );

        progress.report({ message: "Updating cache..." });

        flinkDatabaseProvider.refresh(true);

        progress.report({ message: "UDF deleted successfully." });
      },
    );

    showInfoNotificationWithButtons(
      `UDF "${selectedUdf.name}" deleted successfully from Confluent Cloud.`,
    );
  } catch (err) {
    let errorMessage = "Failed to delete UDF: ";

    if (isResponseError(err)) {
      const resp = await err.response.clone().text();
      errorMessage = `${errorMessage} ${resp}`;
    } else if (err instanceof Error) {
      // extract the error detail from the error message for better error notification
      const flinkDetail = err.message.split("Error detail:")[1]?.trim();
      if (flinkDetail) {
        errorMessage = `${errorMessage} ${flinkDetail}`;
      } else {
        // fall back to regular error message
        errorMessage = `${errorMessage} ${err.message}`;
      }
    }
    logError(err, errorMessage);
    showErrorNotificationWithButtons(errorMessage);
  }
}

export function registerFlinkUDFCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.deleteFlinkUDF", deleteFlinkUDFCommand),
    registerCommandWithLogging(
      "confluent.flinkdatabase.setUDFsViewMode",
      setFlinkUDFViewModeCommand,
    ),
  ];
}
