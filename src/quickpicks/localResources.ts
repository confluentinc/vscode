import { commands, QuickInputButton, QuickPick, QuickPickItem, ThemeIcon, window } from "vscode";
import { IconNames } from "../constants";
import { ContextValues, getContextValue } from "../context/values";
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
  starting: boolean = true,
  placeholder?: string,
): Promise<LocalResourceKind[]> {
  const quickpick: QuickPick<QuickPickItem> = window.createQuickPick();
  quickpick.title = "Local Resources";
  quickpick.ignoreFocusOut = true;
  quickpick.placeholder = placeholder ?? "Select resource types";
  quickpick.canSelectMany = true;

  const items: QuickPickItem[] = [];

  const kafkaRepoTag = `${getLocalKafkaImageName()}:${getLocalKafkaImageTag()}`;
  const kafkaItem: QuickPickItem = {
    label: LocalResourceKind.Kafka,
    iconPath: new ThemeIcon(IconNames.KAFKA_CLUSTER),
    description: kafkaRepoTag,
    detail: "A local Kafka cluster with a user-specified number of broker containers",
    buttons: [{ iconPath: new ThemeIcon("gear"), tooltip: `Select Kafka Docker Image` }],
  };
  const kafkaAvailable: boolean =
    getContextValue(ContextValues.localKafkaClusterAvailable) === true;
  // show the Kafka item if local Kafka isn't already running and this is the start workflow
  // or if local Kafka is already running and this is the stop workflow
  if ((starting && !kafkaAvailable) || (kafkaAvailable && !starting)) {
    items.push(kafkaItem);
  }

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
  const schemaRegistryAvailable: boolean =
    getContextValue(ContextValues.localSchemaRegistryAvailable) === true;
  // show the Schema Registry item if local Schema Registry isn't already running and this is the
  // start workflow or if local Schema Registry is already running and this is the stop workflow
  if ((starting && !schemaRegistryAvailable) || (schemaRegistryAvailable && !starting)) {
    items.push(schemaRegistryItem);
  }

  logger.debug("showing local resource quickpick", {
    starting,
    kafkaAvailable,
    schemaRegistryAvailable,
  });

  if (!starting && items.length === 1) {
    // if only one resource kind is available, don't show the quickpick and just use it by default
    // (we're not doing this for the start workflow because we want to show the user the options and
    // additional details about the resources)
    return [items[0].label as LocalResourceKind];
  }

  quickpick.items = items;
  // set Kafka as selected by default if starting resources and it isn't already running
  quickpick.selectedItems = starting && !kafkaAvailable ? [kafkaItem] : [];
  quickpick.show();

  quickpick.onDidChangeSelection((items: readonly QuickPickItem[]) => {
    if (
      !starting &&
      quickpick.items.includes(schemaRegistryItem) &&
      items.includes(kafkaItem) &&
      !items.includes(schemaRegistryItem)
    ) {
      // if the user is attempting to stop Kafka and not Schema Registry, ensure Schema Registry is
      // selected
      quickpick.selectedItems = [...items, schemaRegistryItem];
      window.showInformationMessage("Schema Registry must be stopped when stopping Kafka.");
    } else if (
      starting &&
      quickpick.items.includes(kafkaItem) &&
      items.includes(schemaRegistryItem) &&
      !items.includes(kafkaItem)
    ) {
      // if the user is attempting to start Schema Registry and not Kafka, ensure Kafka is selected
      quickpick.selectedItems = [kafkaItem, ...items];
      window.showInformationMessage("Kafka must be available before starting Schema Registry.");
    }
  });

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
