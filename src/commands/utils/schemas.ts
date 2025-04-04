import * as vscode from "vscode";

import { Schema, Subject } from "../../models/schema";

/**
 * Determine the prompt to show when deleting a schema version.
 * @param hardDeletion Is a hard delete going to be performed?
 * @param schema The Schema/version to delete.
 * @param schemaGroup All of the live schemas in the subject.
 * @returns Customized prompt for the delete action.
 */
export async function getDeleteSchemaVersionPrompt(
  hardDeletion: boolean,
  schema: Schema,
  schemaGroup: Schema[],
): Promise<string> {
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

/**
 * Determine the prompt to show when deleting an entire subject.
 * @param hardDeletion Is a hard delete going to be performed?
 * @param subject The subject to delete.
 * @param numSchemas The number of live schemas in the subject.
 * @returns Customized prompt for the delete action.
 */
export function getDeleteSchemaSubjectPrompt(
  hardDeletion: boolean,
  subject: Subject,
  numSchemas: number,
): string {
  const isOnlyVersion = numSchemas === 1;

  const deleteVerb = (hardDeletion ? "hard" : "soft") + " delete";
  let prompt: string;

  if (isOnlyVersion) {
    prompt = `Are you sure you want to ${deleteVerb} subject "${subject.name}" and its single schema version?`;
  } else {
    prompt = `Are you sure you want to ${deleteVerb} subject "${subject.name}" and all ${numSchemas} schema versions?`;
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

export function getSubjectDeletionValidatorAndPlaceholder(
  subject: Subject,
  versionCount: number,
  hardDelete: boolean,
): [ValidationFunction, string] {
  let validator: ValidationFunction;
  let prompt: string;

  if (hardDelete) {
    prompt = `Enter "hard ${subject.name} ${versionCount}" to confirm, escape to cancel.`;
    validator = (input: string) => {
      if (input === `hard ${subject.name} ${versionCount}`) {
        return;
      }
      return {
        message: `Enter "hard ${subject.name} ${versionCount}" to confirm hard deletion, escape to cancel.`,
        severity: vscode.InputBoxValidationSeverity.Error,
      };
    };
  } else {
    prompt = `Enter "${subject.name}" to confirm, escape to cancel.`;
    validator = (input: string) => {
      if (input === `${subject.name}`) {
        return;
      }
      return {
        message: `Enter "${subject.name}" to confirm, escape to cancel.`,
        severity: vscode.InputBoxValidationSeverity.Error,
      };
    };
  }

  return [validator, prompt];
}

/**
 * Ask user if they want hard or soft delete behavior.
 *
 * @returns {Promise<boolean>} - true if hard delete, false if soft delete; undefined if cancelled.
 */
export async function hardDeletionQuickPick(noun: string): Promise<boolean | undefined> {
  const strengthStr = await vscode.window.showQuickPick(
    [
      { label: "Soft Delete", description: "All existing records will remain deserializable" },
      {
        label: "Hard Delete",
        description:
          "Any existing records referencing this version will NO LONGER be deserializable",
      },
    ],
    {
      title: `Delete ${noun}`,
      placeHolder: "Select the type of delete to perform",
    },
  );

  if (!strengthStr) {
    return undefined;
  }

  return strengthStr.label.startsWith("Hard");
}

/**
 * Ask the user if they're really sure they want to hard/soft delete this entire subject group?
 *
 * @returns {Promise<true | undefined>} - true if the user confirmed, undefined if they cancelled
 */
export async function confirmSchemaSubjectDeletion(
  hardDelete: boolean,
  subject: Subject,
  schemaGroup: Schema[],
): Promise<true | undefined> {
  const [validator, placeholder] = getSubjectDeletionValidatorAndPlaceholder(
    subject,
    schemaGroup.length,
    hardDelete,
  );
  const confirmationTitle = `${hardDelete ? "HARD " : ""}Delete Subject ${subject.name} and all of its schema versions?`;
  const confirmation = await vscode.window.showInputBox({
    title: confirmationTitle,
    prompt: getDeleteSchemaSubjectPrompt(hardDelete, subject, schemaGroup.length),
    validateInput: validator,
    placeHolder: placeholder,
  });
  if (!confirmation) {
    // User cancelled the input box, cascade the cancellation.
    return undefined;
  }
  // The only other way for showInputBox to return is if the user
  // enters the correct confirmation string, which we already validated.
  return true;
}

/**
 * Ask the user if they're really sure they want to hard/soft delete this schema version
 *
 * @returns {Promise<true | undefined>} - true if the user confirmed, undefined if they cancelled
 * */
export async function confirmSchemaVersionDeletion(
  hardDeletion: boolean,
  schema: Schema,
  schemaGroup: Schema[],
): Promise<true | undefined> {
  const [validator, placeholder] = getSchemaDeletionValidatorAndPlaceholder(
    schema.version,
    hardDeletion,
  );

  const confirmationTitle = `${hardDeletion ? "HARD " : ""}Delete Schema Version ${schema.version}?`;

  const confirmation = await vscode.window.showInputBox({
    title: confirmationTitle,
    prompt: await getDeleteSchemaVersionPrompt(hardDeletion, schema, schemaGroup),
    validateInput: validator,
    placeHolder: placeholder,
  });

  if (!confirmation) {
    // User cancelled the input box, cascade the cancellation.
    return undefined;
  }

  // The only other way for showInputBox to return is if the user
  // enters the correct confirmation string, which we already validated.

  return true;
}
