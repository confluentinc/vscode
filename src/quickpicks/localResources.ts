import { commands, QuickPickItem, ThemeIcon, window } from "vscode";
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
import { createEnhancedQuickPick } from "./utils/quickPickUtils";

const logger = new Logger("quickpicks.localResources");

/** Create a multi-select quickpick to allow the user to choose which resources to start/stop. */
export async function localResourcesQuickPick(
  starting: boolean = true,
  title: string,
  placeholder: string,
): Promise<LocalResourceKind[]> {
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

  // Create the quickpick using our enhanced utility
  const quickpick = await createEnhancedQuickPick(items, {
    title,
    placeHolder: placeholder,
    ignoreFocusOut: true,
    canSelectMany: true,
    selectedItems: starting && !kafkaAvailable ? [kafkaItem] : [],
    onSelectionChange: (items, quickPick) => {
      if (
        !starting &&
        quickPick.items.includes(schemaRegistryItem) &&
        items.includes(kafkaItem) &&
        !items.includes(schemaRegistryItem)
      ) {
        // if the user is attempting to stop Kafka and not Schema Registry, ensure Schema Registry is
        // selected
        quickPick.selectedItems = [...items, schemaRegistryItem];
        window.showInformationMessage("Schema Registry must be stopped when stopping Kafka.");
      } else if (
        starting &&
        quickPick.items.includes(kafkaItem) &&
        items.includes(schemaRegistryItem) &&
        !items.includes(kafkaItem)
      ) {
        // if the user is attempting to start Schema Registry and not Kafka, ensure Kafka is selected
        quickPick.selectedItems = [kafkaItem, ...items];
        window.showInformationMessage("Kafka must be available before starting Schema Registry.");
      }
    },
    onItemButtonClicked: async ({ button, quickPick }) => {
      quickPick.hide();
      if (button.tooltip?.includes(LocalResourceKind.Kafka)) {
        // open Settings and filter to the Kafka image repo+tag settings
        commands.executeCommand(
          "workbench.action.openSettings",
          `@id:${LOCAL_KAFKA_IMAGE} @id:${LOCAL_KAFKA_IMAGE_TAG}`,
        );
      } else if (button.tooltip?.includes(LocalResourceKind.SchemaRegistry)) {
        // open Settings and filter to the Schema Registry image repo+tag settings
        commands.executeCommand(
          "workbench.action.openSettings",
          `@id:${LOCAL_SCHEMA_REGISTRY_IMAGE} @id:${LOCAL_SCHEMA_REGISTRY_IMAGE_TAG}`,
        );
      }
    },
  });

  return quickpick.selectedItems.length > 0
    ? quickpick.selectedItems.map((item) => item.label as LocalResourceKind)
    : [];
}
