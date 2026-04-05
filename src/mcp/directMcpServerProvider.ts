import type { SecretStorageChangeEvent } from "vscode";
import { Logger } from "../logging";
import { SecretStorageKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import { getSecretStorage } from "../storage/utils";
import { BaseMcpServerProvider, type McpConnectionEnvMap } from "./baseMcpServerProvider";
import { connectionSpecToMcpEnv } from "./credentialMapper";

const logger = new Logger("mcp.directMcpServerProvider");

/**
 * MCP server provider for Direct connections. Reads connection specs from SecretStorage and maps
 * their credentials to env vars via {@linkcode connectionSpecToMcpEnv}.
 */
export class DirectMcpServerProvider extends BaseMcpServerProvider {
  constructor() {
    super();

    // fire change event whenever Direct connections are added, removed, or updated
    const secretStorage = getSecretStorage();
    this.disposables.push(
      secretStorage.onDidChange(({ key }: SecretStorageChangeEvent) => {
        if (key === SecretStorageKeys.DIRECT_CONNECTIONS) {
          logger.info("Direct connections changed, notifying MCP server definitions");
          this.changeEmitter.fire();
        }
      }),
    );
  }

  protected async loadConnectionEnvMaps(): Promise<McpConnectionEnvMap[]> {
    const connections = await getResourceManager().getDirectConnections();
    const results: McpConnectionEnvMap[] = [];

    for (const [, spec] of connections) {
      results.push({
        id: spec.id,
        label: `Confluent (Direct): ${spec.name ?? spec.id}`,
        env: connectionSpecToMcpEnv(spec),
      });
    }

    return results;
  }
}
