import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { schemasViewResourceChanged } from "../emitters";
import { SchemaRegistry } from "../models/schemaRegistry";
import { schemaRegistryQuickPickWithViewProgress } from "../quickpicks/schemaRegistries";

export async function selectSchemaRegistryCommand(item?: SchemaRegistry) {
  // ensure whatever was passed in is a SchemaRegistry instance; if not, prompt the user to pick one
  const schemaRegistry =
    item instanceof SchemaRegistry ? item : await schemaRegistryQuickPickWithViewProgress();
  if (!schemaRegistry) {
    return;
  }
  // only called when clicking a Schema Registry in the Resources view; not a dedicated view
  // action or command palette option
  schemasViewResourceChanged.fire(schemaRegistry);
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
