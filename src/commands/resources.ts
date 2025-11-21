import type { Disposable } from "vscode";

import { registerCommandWithLogging } from ".";
import { Logger } from "../logging";
import type { AnyConnectionRow } from "../viewProviders/resources";
import { ConnectionRow, ResourceViewProvider } from "../viewProviders/resources";

const logger = new Logger("commands/resources");

/** User gestured to refresh a single connection in the resources view when new resource view provider is enabled. */
export async function refreshConnectionCommand(connectionRow: AnyConnectionRow): Promise<void> {
  const provider = ResourceViewProvider.getInstance();

  logger.info("refreshConnectionCommand:", {
    connectionRow: JSON.stringify(connectionRow),
    connectionCount: provider["connections"].size,
    connections: JSON.stringify(Object.fromEntries(provider["connections"])),
  });

  if (!connectionRow) {
    throw new Error("No ConnectionRow provided to refreshConnectionCommand");
  }

  if (!(connectionRow instanceof ConnectionRow)) {
    throw new Error("Provided object is not a ConnectionRow");
  }

  await provider.refreshConnection(connectionRow.connectionId);
}

export function registerNewResourceViewCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.resources.refreshConnection", refreshConnectionCommand),
  ];
}
