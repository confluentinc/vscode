import { QuickPick, QuickPickItem, ThemeIcon, window } from "vscode";
import { IconNames } from "../constants";
import { LocalResourceKind } from "../docker/constants";
import { Logger } from "../logging";

const logger = new Logger("quickpicks.localResources");

/** Create a multi-select quickpick to allow the user to choose which resources to launch. */
export async function localResourcesQuickPick(): Promise<LocalResourceKind[]> {
  const quickpick: QuickPick<QuickPickItem> = window.createQuickPick();
  quickpick.title = "Local Resources";
  quickpick.ignoreFocusOut = true;
  quickpick.placeholder = "Select resources to launch";
  quickpick.canSelectMany = true;

  quickpick.items = [
    {
      label: LocalResourceKind.Kafka,
      iconPath: new ThemeIcon(IconNames.CCLOUD_KAFKA),
      detail: "A local Kafka cluster with a user-specified number of broker containers",
      picked: true,
    },
    {
      label: LocalResourceKind.SchemaRegistry,
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

  return selectedItems.length > 0
    ? selectedItems.map((item) => item.label as LocalResourceKind)
    : [];
}
