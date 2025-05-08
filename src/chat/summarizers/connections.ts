import { MarkdownString } from "vscode";
import {
  CCloudStatus,
  Connection,
  ConnectionType,
  KafkaClusterConfig,
  KafkaClusterStatus,
  SchemaRegistryConfig,
  SchemaRegistryStatus,
} from "../../clients/sidecar";
import { titleCase } from "../../utils";

/** Create a string representation of a {@link Connection} object. */
export function summarizeConnection(connection: Connection): string {
  const type: ConnectionType = connection.spec.type!;
  let summary = new MarkdownString().appendMarkdown(
    `# ${titleCase(type)} Connection: "${connection.spec.name}"`,
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
  const expiration: Date = status.requires_authentication_at!;
  const hoursUntilExpiration: number = Math.floor(
    (expiration.getTime() - new Date().getTime()) / (1000 * 60 * 60),
  );
  summary = summary
    .appendMarkdown(`\n\n**State:** ${status.state}`)
    .appendMarkdown(
      `\n\n**Auth Session Expires At:** ${expiration.toLocaleDateString()} ${expiration.toLocaleTimeString()} (in ${hoursUntilExpiration} hour${hoursUntilExpiration === 1 ? "" : "s"})`,
    )
    .appendMarkdown(`\n(Sign-in link: ${connection.metadata.sign_in_uri})`);
  if (status.errors) {
    summary = summary
      .appendMarkdown(`\n\n**Errors:**`)
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
  summary.appendMarkdown(`\n\n## Local Connection Status`);
  // TODO: look up Docker container details
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
      .appendMarkdown(`\n\n**Bootstrap Servers:** ${kafkaConfig.bootstrap_servers}`)
      .appendMarkdown(`\n\n**Status:** ${kafkaStatus.state}`);
    if (kafkaStatus.errors) {
      summary = summary
        .appendMarkdown(`\n\n**Errors:**`)
        .appendCodeblock(JSON.stringify(kafkaStatus.errors, null, 2), "json");
    }
  }

  const schemaRegistryConfig: SchemaRegistryConfig | undefined = connection.spec.schema_registry;
  if (schemaRegistryConfig) {
    const schemaRegistryStatus: SchemaRegistryStatus = connection.status.schema_registry!;
    summary = summary
      .appendMarkdown(`\n\n**Schema Registry URL:** ${schemaRegistryConfig.uri}`)
      .appendMarkdown(`\n\n**Status:** ${schemaRegistryStatus.state}`);
    if (schemaRegistryStatus.errors) {
      summary = summary
        .appendMarkdown(`\n\n**Errors:**`)
        .appendCodeblock(JSON.stringify(schemaRegistryStatus.errors, null, 2), "json");
    }
  }
  return summary;
}
