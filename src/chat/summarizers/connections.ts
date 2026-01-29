import { MarkdownString } from "vscode";
import type {
  CCloudStatus,
  Connection,
  KafkaClusterConfig,
  KafkaClusterStatus,
  LocalConfig,
  SchemaRegistryConfig,
  SchemaRegistryStatus,
} from "../../connections";
import { ConnectedState, ConnectionType } from "../../connections";
import { ContextValues, getContextValue } from "../../context/values";

/** Create a string representation of a {@link Connection} object. */
export function summarizeConnection(connection: Connection): string {
  const type: ConnectionType = connection.spec.type!;
  let summary = new MarkdownString().appendMarkdown(
    `### "${connection.spec.name}" (ID: ${connection.spec.id})`,
  );

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

  const expiration: Date = status.requiresAuthenticationAt!;
  const hoursUntilExpiration: number = Math.floor(
    (expiration.getTime() - new Date().getTime()) / (1000 * 60 * 60),
  );
  summary = summary
    .appendMarkdown(`\n- Status: ${status.state}`)
    .appendMarkdown(
      `\n- Auth Session Expires At: ${expiration.toLocaleDateString()} ${expiration.toLocaleTimeString()} (in ${hoursUntilExpiration} hour${hoursUntilExpiration === 1 ? "" : "s"})`,
    );
  if (hoursUntilExpiration <= 1) {
    summary = summary.appendMarkdown(`\n- Sign-In Link: ${connection.metadata.signInUri}`);
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
    .appendMarkdown("\n- Kafka")
    .appendMarkdown(
      `\n  - Status: ${kafkaAvailable ? ConnectedState.SUCCESS : ConnectedState.NONE}`,
    );

  // Update this if/when we migrate LOCAL connections to DIRECT
  // https://github.com/confluentinc/vscode/issues/522
  // local_config only exists if the SR URI is set
  const config: LocalConfig | undefined = connection.spec.localConfig;
  const schemaRegistryAvailable: boolean =
    getContextValue(ContextValues.localSchemaRegistryAvailable) ?? false;
  summary
    .appendMarkdown("\n- Schema Registry")
    .appendMarkdown(
      `\n  - Status: ${schemaRegistryAvailable ? ConnectedState.SUCCESS : ConnectedState.NONE}`,
    );
  if (config && schemaRegistryAvailable) {
    summary.appendMarkdown(`\n  - URI: ${config.schemaRegistryUri}`);
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
  const kafkaConfig: KafkaClusterConfig | undefined = connection.spec.kafkaCluster;
  if (kafkaConfig) {
    const kafkaStatus: KafkaClusterStatus = connection.status.kafkaCluster!;
    summary = summary
      .appendMarkdown("\n- Kafka Cluster")
      .appendMarkdown(`\n  - Bootstrap Servers: ${kafkaConfig.bootstrapServers}`)
      .appendMarkdown(`\n  - Status: ${kafkaStatus.state}`);
    if (kafkaStatus.errors) {
      summary = summary
        .appendMarkdown(`\n  - Errors:`)
        .appendCodeblock(JSON.stringify(kafkaStatus.errors, null, 2), "json");
    }
  }

  const schemaRegistryConfig: SchemaRegistryConfig | undefined = connection.spec.schemaRegistry;
  if (schemaRegistryConfig) {
    const schemaRegistryStatus: SchemaRegistryStatus = connection.status.schemaRegistry!;
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
