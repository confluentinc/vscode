import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { currentSchemaRegistryChanged } from "../emitters";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { schemaRegistryQuickPick } from "../quickpicks/schemaRegistryClusters";

async function selectSchemaRegistryCommand(cluster?: SchemaRegistryCluster) {
  // ensure whatever was passed in is a SchemaRegistryCluster; if not, prompt the user to pick one
  const schemaRegistry =
    cluster instanceof SchemaRegistryCluster ? cluster : await schemaRegistryQuickPick();
  if (!schemaRegistry) {
    return;
  }
  // only called when clicking a Schema Registry in the Resources view; not a dedicated view
  // action or command palette option
  currentSchemaRegistryChanged.fire(schemaRegistry);
  vscode.commands.executeCommand("confluent-schemas.focus");
}

export const commands = [
  registerCommandWithLogging(
    "confluent.resources.schema-registry.select",
    selectSchemaRegistryCommand,
  ),
];
