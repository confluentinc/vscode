import { MarkdownString } from "vscode";
import {
  CCloudStatus,
  ConnectedState,
  Connection,
  ConnectionType,
  KafkaClusterConfig,
  KafkaClusterStatus,
  LocalConfig,
  SchemaRegistryConfig,
  SchemaRegistryStatus,
} from "../../clients/sidecar";
import { ContextValues, getContextValue } from "../../context/values";

/** Create a string representation of a {@link Connection} object. */
export function summarizeConnection(connection: Connection): string {
  const type: ConnectionType = connection.spec.type!;
  let summary = new MarkdownString().appendMarkdown(`### "${connection.spec.name}"`);

  // add spec/status details depending on the connection type
  switch (type) {
    case ConnectionType.Ccloud: {
      summary = summarizeCCloudConnection(connection, summary);
      break;
    }
    case ConnectionType.Local: {
      summary = summarizeLocalConnection(connection, summary);
      break;
    }
    case ConnectionType.Direct: {
      summary = summarizeDirectConnection(connection, summary);
      break;
    }
  }
  return summary.value;
}

/**
 * Summarize the `CCLOUD` {@link Connection}.
 * @param connection The {@link Connection} object to summarize.
 * @param summary The {@link MarkdownString} to append to.
 * @returns The updated {@link MarkdownString}.
 */
export function summarizeCCloudConnection(
  connection: Connection,
  summary: MarkdownString,
): MarkdownString {
  const status: CCloudStatus = connection.status.ccloud!;

  const expiration: Date = status.requires_authentication_at!;
  const hoursUntilExpiration: number = Math.floor(
    (expiration.getTime() - new Date().getTime()) / (1000 * 60 * 60),
  );
  summary = summary
    .appendMarkdown(`\n- Status: ${status.state}`)
    .appendMarkdown(
      `\n- Auth Session Expires At: ${expiration.toLocaleDateString()} ${expiration.toLocaleTimeString()} (in ${hoursUntilExpiration} hour${hoursUntilExpiration === 1 ? "" : "s"})`,
    );
  if (hoursUntilExpiration <= 1) {
    summary = summary.appendMarkdown(`\n- Sign-In Link: ${connection.metadata.sign_in_uri}`);
  }
  if (status.errors) {
    summary = summary
      .appendMarkdown(`\n- Errors:`)
      .appendCodeblock(JSON.stringify(status.errors, null, 2), "json");
  }
  return summary;
}

/**
 * Summarize the `LOCAL` {@link Connection}.
 * @param connection The {@link Connection} object to summarize.
 * @param summary The {@link MarkdownString} to append to.
 * @returns The updated {@link MarkdownString}.
 */
export function summarizeLocalConnection(
  connection: Connection,
  summary: MarkdownString,
): MarkdownString {
  const kafkaAvailable: boolean =
    getContextValue(ContextValues.localKafkaClusterAvailable) ?? false;
  summary
    .appendMarkdown("\n- Kafka Cluster")
    .appendMarkdown(
      `\n  - Status: ${kafkaAvailable ? ConnectedState.Success : ConnectedState.None}`,
    );

  // TODO(shoup): update this once we migrate LOCAL connections to DIRECT
  // local_config only exists if the SR URI is set
  const config: LocalConfig | undefined = connection.spec.local_config;
  const schemaRegistryAvailable: boolean =
    getContextValue(ContextValues.localSchemaRegistryAvailable) ?? false;
  summary
    .appendMarkdown("\n- Schema Registry")
    .appendMarkdown(
      `\n  - Status: ${schemaRegistryAvailable ? ConnectedState.Success : ConnectedState.None}`,
    );
  if (config && schemaRegistryAvailable) {
    summary.appendMarkdown(`\n  - URI: ${config.schema_registry_uri}`);
  }

  return summary;
}

/**
 * Summarize the `DIRECT` {@link Connection} based on the {@link KafkaClusterConfig}
 * @param connection The {@link Connection} object to summarize.
 * @param summary The {@link MarkdownString} to append to.
 * @returns The updated {@link MarkdownString}.
 */
export function summarizeDirectConnection(
  connection: Connection,
  summary: MarkdownString,
): MarkdownString {
  const kafkaConfig: KafkaClusterConfig | undefined = connection.spec.kafka_cluster;
  if (kafkaConfig) {
    const kafkaStatus: KafkaClusterStatus = connection.status.kafka_cluster!;
    summary = summary
      .appendMarkdown("\n- Kafka Cluster")
      .appendMarkdown(`\n  - Bootstrap Servers: ${kafkaConfig.bootstrap_servers}`)
      .appendMarkdown(`\n  - Status: ${kafkaStatus.state}`);
    if (kafkaStatus.errors) {
      summary = summary
        .appendMarkdown(`\n  - Errors:`)
        .appendCodeblock(JSON.stringify(kafkaStatus.errors, null, 2), "json");
    }
  }

  const schemaRegistryConfig: SchemaRegistryConfig | undefined = connection.spec.schema_registry;
  if (schemaRegistryConfig) {
    const schemaRegistryStatus: SchemaRegistryStatus = connection.status.schema_registry!;
    summary = summary
      .appendMarkdown("\n- Schema Registry")
      .appendMarkdown(`\n  - URI: ${schemaRegistryConfig.uri}`)
      .appendMarkdown(`\n  - Status: ${schemaRegistryStatus.state}`);
    if (schemaRegistryStatus.errors) {
      summary = summary
        .appendMarkdown(`\n  - Errors:`)
        .appendCodeblock(JSON.stringify(schemaRegistryStatus.errors, null, 2), "json");
    }
  }
  return summary;
}
