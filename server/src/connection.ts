import type { Connection } from "vscode-languageserver";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";

let connection: Connection | undefined;

export function getConnection() {
  if (!connection) {
    // For ES modules, we need to use the correct overload
    connection = createConnection(ProposedFeatures.all);
  }
  return connection;
}
