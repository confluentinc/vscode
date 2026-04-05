import type { Disposable } from "vscode";
import { lm } from "vscode";
import { Logger } from "../logging";
import type { BaseMcpServerProvider } from "./baseMcpServerProvider";
import { DirectMcpServerProvider } from "./directMcpServerProvider";
import { LocalMcpServerProvider } from "./localMcpServerProvider";

const logger = new Logger("mcp.serverProvider");

/** Provider ID to class mapping. IDs must match `contributes.mcpServerDefinitionProviders`. */
const PROVIDERS: ReadonlyArray<{
  id: string;
  create: () => BaseMcpServerProvider;
}> = [
  { id: "confluent-mcp-direct", create: () => new DirectMcpServerProvider() },
  { id: "confluent-mcp-local", create: () => new LocalMcpServerProvider() },
];

/**
 * Register all connection-type-specific MCP server definition providers and return a single
 * {@link Disposable} that tears them all down.
 */
export function registerMcpServerProviders(): Disposable {
  const disposables: Disposable[] = [];

  for (const { id, create } of PROVIDERS) {
    const provider = create();
    const registration = lm.registerMcpServerDefinitionProvider(id, provider);
    disposables.push(registration, provider);
    logger.info(`Registered MCP server provider "${id}"`);
  }

  return {
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
