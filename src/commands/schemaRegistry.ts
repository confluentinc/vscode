import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { currentSchemaRegistryChanged } from "../emitters";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { schemaRegistryQuickPickWithViewProgress } from "../quickpicks/schemaRegistries";

async function selectSchemaRegistryCommand(cluster?: SchemaRegistry) {
  // ensure whatever was passed in is a SchemaRegistry instance; if not, prompt the user to pick one
  // TODO(shoup): update to support LocalSchemaRegistry
  const schemaRegistry =
    cluster instanceof CCloudSchemaRegistry
      ? cluster
      : await schemaRegistryQuickPickWithViewProgress();
  if (!schemaRegistry) {
    return;
  }
  // only called when clicking a Schema Registry in the Resources view; not a dedicated view
  // action or command palette option
  currentSchemaRegistryChanged.fire(schemaRegistry);
  vscode.commands.executeCommand("confluent-schemas.focus");
}

export function registerSchemaRegistryCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.resources.schema-registry.select",
      selectSchemaRegistryCommand,
    ),
  ];
}
