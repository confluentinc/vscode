import { commands, QuickInputButton, QuickPick, QuickPickItem, ThemeIcon, window } from "vscode";
import { IconNames } from "../constants";
import {
  getLocalKafkaImageName,
  getLocalKafkaImageTag,
  getLocalSchemaRegistryImageName,
  getLocalSchemaRegistryImageTag,
} from "../docker/configs";
import { LocalResourceKind } from "../docker/constants";
import { Logger } from "../logging";
import {
  LOCAL_KAFKA_IMAGE,
  LOCAL_KAFKA_IMAGE_TAG,
  LOCAL_SCHEMA_REGISTRY_IMAGE,
  LOCAL_SCHEMA_REGISTRY_IMAGE_TAG,
} from "../preferences/constants";

const logger = new Logger("quickpicks.localResources");

/** Create a multi-select quickpick to allow the user to choose which resources to start/stop. */
export async function localResourcesQuickPick(
  toStart: boolean = true,
  placeholder?: string,
): Promise<LocalResourceKind[]> {
  const quickpick: QuickPick<QuickPickItem> = window.createQuickPick();
  quickpick.title = "Local Resources";
  quickpick.ignoreFocusOut = true;
  quickpick.placeholder = placeholder ?? "Select resource types";
  quickpick.canSelectMany = true;

  const kafkaRepoTag = `${getLocalKafkaImageName()}:${getLocalKafkaImageTag()}`;
  const kafkaItem: QuickPickItem = {
    label: LocalResourceKind.Kafka,
    iconPath: new ThemeIcon(IconNames.KAFKA_CLUSTER),
    description: kafkaRepoTag,
    detail: "A local Kafka cluster with a user-specified number of broker containers",
    buttons: [{ iconPath: new ThemeIcon("gear"), tooltip: `Select Kafka Docker Image` }],
  };

  const schemaRegistryRepoTag = `${getLocalSchemaRegistryImageName()}:${getLocalSchemaRegistryImageTag()}`;
  const schemaRegistryItem: QuickPickItem = {
    label: LocalResourceKind.SchemaRegistry,
    iconPath: new ThemeIcon(IconNames.SCHEMA_REGISTRY),
    description: schemaRegistryRepoTag,
    detail: "A local Schema Registry instance that can be used to manage schemas for Kafka topics",
    buttons: [
      { iconPath: new ThemeIcon("gear"), tooltip: `Select Schema Registry Docker Image Tag` },
    ],
  };

  quickpick.items = [kafkaItem, schemaRegistryItem];
  // set Kafka as selected by default if starting resources
  quickpick.selectedItems = toStart ? [kafkaItem] : [];
  quickpick.show();

  const selectedItems: QuickPickItem[] = [];
  quickpick.onDidAccept(() => {
    logger.debug("selected items", { items: JSON.stringify(quickpick.selectedItems) });
    selectedItems.push(...quickpick.selectedItems);
    quickpick.hide();
    return;
  });

  quickpick.onDidTriggerItemButton(
    async (event: { button: QuickInputButton; item: QuickPickItem }) => {
      quickpick.hide();
      if (event.button.tooltip?.includes(LocalResourceKind.Kafka)) {
        // open Settings and filter to the Kafka image repo+tag settings
        commands.executeCommand(
          "workbench.action.openSettings",
          `@id:${LOCAL_KAFKA_IMAGE} @id:${LOCAL_KAFKA_IMAGE_TAG}`,
        );
      } else if (event.button.tooltip?.includes(LocalResourceKind.SchemaRegistry)) {
        // open Settings and filter to the Schema Registry image repo+tag settings
        commands.executeCommand(
          "workbench.action.openSettings",
          `@id:${LOCAL_SCHEMA_REGISTRY_IMAGE} @id:${LOCAL_SCHEMA_REGISTRY_IMAGE_TAG}`,
        );
      }
    },
  );

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
