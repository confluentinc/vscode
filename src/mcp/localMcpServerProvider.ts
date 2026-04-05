import { Logger } from "../logging";
import { LocalResourceLoader } from "../loaders/localResourceLoader";
import { McpEnvVar } from "./credentialMapper";
import { BaseMcpServerProvider, type McpConnectionEnvMap } from "./baseMcpServerProvider";

const logger = new Logger("mcp.localMcpServerProvider");

/**
 * MCP server provider for Local (Docker-based) connections. Reads Kafka cluster bootstrap servers
 * and Schema Registry URI from the {@link LocalResourceLoader} if one is registered.
 *
 * No credentials are needed for local connections; only `BOOTSTRAP_SERVERS` and
 * `SCHEMA_REGISTRY_ENDPOINT` are set.
 *
 * Change events are not wired up because local resource discovery is Docker-event-driven and lacks
 * a convenient observable. The `resolveMcpServerDefinition` callback re-reads resources at server
 * start time, which is sufficient for picking up container start/stop changes.
 */
export class LocalMcpServerProvider extends BaseMcpServerProvider {
  protected async loadConnectionEnvMaps(): Promise<McpConnectionEnvMap[]> {
    let loader: LocalResourceLoader;
    try {
      loader = LocalResourceLoader.getInstance();
    } catch {
      // no local connection registered (Docker unavailable or not started yet)
      return [];
    }

    const env: Record<string, string> = {};

    try {
      const clusters = await loader.getKafkaClusters();
      if (clusters.length > 0) {
        env[McpEnvVar.BOOTSTRAP_SERVERS] = clusters[0].bootstrapServers;
      }
    } catch (e) {
      logger.warn("Failed to load local Kafka clusters for MCP server", e);
    }

    try {
      const registries = await loader.getSchemaRegistries();
      if (registries.length > 0) {
        env[McpEnvVar.SCHEMA_REGISTRY_ENDPOINT] = registries[0].uri;
      }
    } catch (e) {
      logger.warn("Failed to load local Schema Registries for MCP server", e);
    }

    if (Object.keys(env).length === 0) {
      return [];
    }

    return [{ id: "local", label: "Confluent (Local)", env }];
  }
}
