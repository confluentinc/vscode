import * as vscode from "vscode";

import { ResourceLoader } from "../../loaders";
import { Schema } from "../../models/schema";

/**
 * Determine the prompt to show when deleting a schema version.
 * @param hardDeletion Is a hard delete going to be performed?
 * @param schema The Schema/version to delete.
 * @param loader ResourceLoader to use to get the schema group.
 * @returns Customized prompt for the delete action.
 */
export async function getDeleteSchemaVersionPrompt(
  hardDeletion: boolean,
  schema: Schema,
  loader: ResourceLoader,
): Promise<string> {
  const schemaGroup = await loader.getSchemasForSubject(schema.environmentId!, schema.subject);
  const isOnlyVersion = schemaGroup.length === 1;

  const deleteVerb = (hardDeletion ? "hard" : "soft") + " delete";
  let prompt: string;

  if (isOnlyVersion) {
    prompt = `Are you sure you want to ${deleteVerb} the only version of subject ${schema.subject}?`;
  } else {
    const isLatestVersion = schema.version === schemaGroup[0].version;
    if (isLatestVersion) {
      prompt = `Are you sure you want to ${deleteVerb} the latest version of subject ${schema.subject}? Version ${schemaGroup[1].version} will become the latest.`;
    } else {
      prompt = `Are you sure you want to ${deleteVerb} version ${schema.version} of subject ${schema.subject}?`;
    }
  }

  return prompt;
}

/** Function signature for vscode input validators */
export type ValidationFunction = (input: string) => vscode.InputBoxValidationMessage | undefined;

/**
 * Returns a pair:
 *  [0]: Function that can be used to validate the confirmation input for a schema version for deletion.
 *  [1]: The string to show in the input box as a placeholder.
 * @param version The version to confirm.
 * @param hardDeletion Whether this is for a hard deletion or not.
 * @returns pair of [validation function, prompt string]
 */
export function getSchemaDeletionValidatorAndPlaceholder(
  version: number,
  hardDeletion: boolean,
): [ValidationFunction, string] {
  let validator: ValidationFunction;
  let prompt: string;

  if (hardDeletion) {
    prompt = `Enter "hard v${version}" to confirm, escape to cancel.`;
    validator = (input: string) => {
      if (input === `hard v${version}`) {
        return;
      }
      return {
        message: `Enter "hard v${version}" to confirm hard deletion, escape to cancel.`,
        severity: vscode.InputBoxValidationSeverity.Error,
      };
    };
  } else {
    prompt = `Enter "v${version}" to confirm, escape to cancel.`;
    validator = (input: string) => {
      if (input === `v${version}`) {
        return;
      }
      return {
        message: `Enter "v${version}" to confirm, escape to cancel.`,
        severity: vscode.InputBoxValidationSeverity.Error,
      };
    };
  }

  return [validator, prompt];
}
