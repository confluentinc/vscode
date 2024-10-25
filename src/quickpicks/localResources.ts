import { QuickPick, QuickPickItem, ThemeIcon, window } from "vscode";
import { IconNames } from "../constants";
import { Logger } from "../logging";

const logger = new Logger("quickpicks.localResources");

export const KAFKA_RESOURCE_LABEL = "Kafka";
export const SCHEMA_REGISTRY_RESOURCE_LABEL = "Schema Registry";

/** Create a multi-select quickpick to allow the user to choose which resources to launch. */
export async function localResourcesQuickPick(): Promise<QuickPickItem[]> {
  const quickpick: QuickPick<QuickPickItem> = window.createQuickPick();
  quickpick.title = "Local Resources";
  quickpick.ignoreFocusOut = true;
  quickpick.placeholder = "Select resource types";
  quickpick.canSelectMany = true;

  quickpick.items = [
    {
      label: KAFKA_RESOURCE_LABEL,
      iconPath: new ThemeIcon(IconNames.KAFKA_CLUSTER),
      detail: "A local Kafka cluster with a user-specified number of broker containers",
      picked: true,
    },
    {
      label: SCHEMA_REGISTRY_RESOURCE_LABEL,
      iconPath: new ThemeIcon(IconNames.SCHEMA_REGISTRY),
      detail:
        "A local Schema Registry instance that can be used to manage schemas for Kafka topics",
    },
  ];
  quickpick.show();

  const selectedItems: QuickPickItem[] = [];
  quickpick.onDidAccept(() => {
    logger.debug("selected items", { items: JSON.stringify(quickpick.selectedItems) });
    selectedItems.push(...quickpick.selectedItems);
    quickpick.hide();
    return;
  });

  // block until the quickpick is hidden
  await new Promise<void>((resolve) => {
    quickpick.onDidHide(() => {
      resolve();
    });
  });

  return selectedItems;
}
