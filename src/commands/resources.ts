import { Disposable } from "vscode";

import { registerCommandWithLogging } from ".";
import {
  AnyConnectionRow,
  ConnectionRow,
  NewResourceViewProvider,
} from "../viewProviders/newResources";

export async function refreshConnectionCommand(connectionRow: AnyConnectionRow): Promise<void> {
  if (!connectionRow) {
    throw new Error("No ConnectionRow provided to refreshConnectionCommand");
  }

  if (!(connectionRow instanceof ConnectionRow)) {
    throw new Error("Provided object is not a ConnectionRow");
  }

  const provider = NewResourceViewProvider.getInstance();
  await provider.refreshConnection(connectionRow.connectionId, true);
}

export function registerNewResourceViewCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.resources.refreshConnection", refreshConnectionCommand),
  ];
}
