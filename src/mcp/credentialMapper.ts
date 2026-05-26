import { instanceOfApiKeyAndSecret, instanceOfBasicCredentials } from "../clients/sidecar";
import type { CustomConnectionSpec } from "../storage/resourceManager";

/**
 * Environment variable names expected by the `@confluentinc/mcp-confluent` server. Only the subset
 * that can be derived from a {@link CustomConnectionSpec} is listed here.
 */
export enum McpEnvVar {
  BOOTSTRAP_SERVERS = "BOOTSTRAP_SERVERS",
  KAFKA_API_KEY = "KAFKA_API_KEY",
  KAFKA_API_SECRET = "KAFKA_API_SECRET",
  SCHEMA_REGISTRY_ENDPOINT = "SCHEMA_REGISTRY_ENDPOINT",
  SCHEMA_REGISTRY_API_KEY = "SCHEMA_REGISTRY_API_KEY",
  SCHEMA_REGISTRY_API_SECRET = "SCHEMA_REGISTRY_API_SECRET",
}

/**
 * Convert a {@link CustomConnectionSpec} into the environment variables needed to start the
 * `mcp-confluent` server via stdio. Only credential types that map cleanly to the server's
 * SASL/PLAIN auth model (API key/secret and Basic username/password) are supported; other auth
 * types (SCRAM, OAuth, Kerberos) are ignored because the MCP server has no equivalent config.
 */
export function connectionSpecToMcpEnv(spec: CustomConnectionSpec): Record<string, string> {
  const env: Record<string, string> = {};

  mapKafkaClusterEnv(spec, env);
  mapSchemaRegistryEnv(spec, env);

  return env;
}

/** Extract Kafka cluster bootstrap servers and credentials from the connection spec. */
function mapKafkaClusterEnv(spec: CustomConnectionSpec, env: Record<string, string>): void {
  const kafka = spec.kafka_cluster;
  if (!kafka) return;

  if (kafka.bootstrap_servers) {
    env[McpEnvVar.BOOTSTRAP_SERVERS] = kafka.bootstrap_servers;
  }

  const creds = kafka.credentials;
  if (!creds) return;

  // API key/secret and Basic (username/password) both map to the MCP server's SASL/PLAIN auth
  if (instanceOfApiKeyAndSecret(creds)) {
    env[McpEnvVar.KAFKA_API_KEY] = creds.api_key;
    env[McpEnvVar.KAFKA_API_SECRET] = creds.api_secret;
  } else if (instanceOfBasicCredentials(creds)) {
    env[McpEnvVar.KAFKA_API_KEY] = creds.username;
    env[McpEnvVar.KAFKA_API_SECRET] = creds.password;
  }
}

/** Extract Schema Registry URI and credentials from the connection spec. */
function mapSchemaRegistryEnv(spec: CustomConnectionSpec, env: Record<string, string>): void {
  const sr = spec.schema_registry;
  if (!sr) return;

  if (sr.uri) {
    env[McpEnvVar.SCHEMA_REGISTRY_ENDPOINT] = sr.uri;
  }

  const creds = sr.credentials;
  if (!creds) return;

  if (instanceOfApiKeyAndSecret(creds)) {
    env[McpEnvVar.SCHEMA_REGISTRY_API_KEY] = creds.api_key;
    env[McpEnvVar.SCHEMA_REGISTRY_API_SECRET] = creds.api_secret;
  } else if (instanceOfBasicCredentials(creds)) {
    env[McpEnvVar.SCHEMA_REGISTRY_API_KEY] = creds.username;
    env[McpEnvVar.SCHEMA_REGISTRY_API_SECRET] = creds.password;
  }
}
