import * as vscode from "vscode";
import type { ProduceMessage } from "../diagnostics/produceMessage";
import { logUsage, UserEvent } from "../telemetry/events";

/**
 * Which optional Kafka control fields to include in a produce request.
 *
 * `true` means the field should be sent for any record that specifies it; `false` means it should
 * be stripped from the record(s) before producing.
 */
export interface ControlFieldSelection {
  partitionId: boolean;
  timestamp: boolean;
}

const PARTITION_ID_LABEL = "Partition ID";
const TIMESTAMP_LABEL = "Timestamp";

/** Whether the given records specify `partition_id` and/or `timestamp` in at least one record. */
export function detectControlFields(contents: ProduceMessage[]): ControlFieldSelection {
  return {
    partitionId: contents.some((record) => record.partition_id !== undefined),
    timestamp: contents.some((record) => record.timestamp !== undefined),
  };
}

/**
 * If any record specifies the `partition_id` and/or `timestamp` control field(s), prompt the user
 * to confirm which of those to include in the produce request. Both present fields are pre-selected,
 * so confirming without changes preserves the record(s) as written.
 *
 * @returns the control fields to include, or `undefined` if the user cancelled the quickpick.
 *   When no control fields are present, resolves immediately (no quickpick) with both `false`, since
 *   there is nothing to include or strip.
 */
export async function produceControlFieldMultiSelect(
  contents: ProduceMessage[],
): Promise<ControlFieldSelection | undefined> {
  const present: ControlFieldSelection = detectControlFields(contents);
  if (!present.partitionId && !present.timestamp) {
    return { partitionId: false, timestamp: false };
  }

  // pre-select present fields so this is an opt-out: producing already sends any control field a
  // record specifies, so checked-by-default preserves that behavior
  const items: vscode.QuickPickItem[] = [];
  if (present.partitionId) {
    items.push({
      label: PARTITION_ID_LABEL,
      description: "Route each record to its specified partition",
      picked: true,
      iconPath: new vscode.ThemeIcon("symbol-number"),
    });
  }
  if (present.timestamp) {
    items.push({
      label: TIMESTAMP_LABEL,
      description: "Produce each record with its specified timestamp",
      picked: true,
      iconPath: new vscode.ThemeIcon("watch"),
    });
  }

  const selectedItems: vscode.QuickPickItem[] | undefined = await vscode.window.showQuickPick(
    items,
    {
      canPickMany: true,
      title: "Include control fields in produce request?",
      placeHolder: "Deselect any control field(s) to omit from the record(s)",
      ignoreFocusOut: true,
    },
  );
  if (selectedItems === undefined) {
    // user cancelled
    return;
  }

  // a label is only ever offered when that field is present, so a match here implies presence
  const selection: ControlFieldSelection = {
    partitionId: selectedItems.some((item) => item.label === PARTITION_ID_LABEL),
    timestamp: selectedItems.some((item) => item.label === TIMESTAMP_LABEL),
  };
  logUsage(UserEvent.MessageProduceAction, {
    status: "selected produce control fields",
    partitionIdSelected: selection.partitionId,
    timestampSelected: selection.timestamp,
  });
  return selection;
}

/**
 * Delete any control-field key the user opted out of from each record, mutating the record(s) in
 * place so the stripped field is not sent in the produce request.
 */
export function stripDeselectedControlFields(
  contents: ProduceMessage[],
  selection: ControlFieldSelection,
): void {
  for (const record of contents) {
    if (!selection.partitionId) {
      delete record.partition_id;
    }
    if (!selection.timestamp) {
      delete record.timestamp;
    }
  }
}
